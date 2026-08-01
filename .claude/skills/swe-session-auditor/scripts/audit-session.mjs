#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const SEVERITY_RANK = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const TEST_COMMAND_PATTERN =
  /\b(pytest|unittest|tox|runtests(?:\.py)?|manage\.py\s+test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|cargo\s+test|go\s+test|jest|vitest|mocha)\b/i;

const cli = parseArgs(process.argv.slice(2));
if (cli.help || (!cli.input && !cli.events && !cli.transcript && !cli.summary)) {
  printUsage();
  process.exit(cli.help ? 0 : 2);
}

const request = resolveRequest(cli);
const report = request.scope === "run"
  ? analyzeRun(request)
  : analyzeItem(request);
const outputPath = resolveOutputPath(cli.output, request);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const summary = summarizeReport(report);
process.stdout.write(`${JSON.stringify({ outputPath, ...summary }, null, 2)}\n`);

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }

    const key = value.slice(2).replace(/-([a-z])/g, (_, char) =>
      char.toUpperCase()
    );
    if (key === "help") {
      result.help = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}`);
    }
    result[key] = next;
    index++;
  }
  result.input ??= result._[0];
  return result;
}

function printUsage() {
  process.stdout.write([
    "Usage:",
    "  node audit-session.mjs --input <run-dir|item-dir|jsonl> [options]",
    "",
    "Options:",
    "  --instance-id <id>   Select one Item from a run",
    "  --events <path>       Explicit events.jsonl",
    "  --transcript <path>   Explicit transcript JSONL",
    "  --summary <path>      Explicit run summary.json",
    "  --patch <path>        Explicit patch.diff",
    "  --output <path>       Output JSON path or directory",
    "",
  ].join("\n"));
}

function resolveRequest(args) {
  const explicit = {
    eventsPath: resolveOptional(args.events),
    transcriptPath: resolveOptional(args.transcript),
    summaryPath: resolveOptional(args.summary),
    patchPath: resolveOptional(args.patch),
    instanceId: args.instanceId,
  };
  if (!args.input) {
    return {
      scope: "item",
      label: explicit.instanceId ?? "explicit-session",
      ...explicit,
    };
  }

  const inputPath = resolve(args.input);
  if (!existsSync(inputPath)) {
    throw new Error(`Input does not exist: ${inputPath}`);
  }

  if (statSync(inputPath).isDirectory()) {
    const summaryPath = explicit.summaryPath ?? join(inputPath, "summary.json");
    if (existsSync(summaryPath)) {
      if (explicit.instanceId) {
        return resolveItemFromRun(summaryPath, explicit.instanceId, explicit);
      }
      return {
        ...explicit,
        scope: "run",
        label: basename(inputPath),
        runDir: inputPath,
        summaryPath,
      };
    }

    const eventsPath = explicit.eventsPath ?? join(inputPath, "events.jsonl");
    const patchPath = explicit.patchPath ?? join(inputPath, "patch.diff");
    const parentSummary = findParentSummary(inputPath);
    const instanceId = explicit.instanceId ?? basename(inputPath);
    return {
      scope: "item",
      label: instanceId,
      itemDir: inputPath,
      eventsPath: existsSync(eventsPath) ? eventsPath : undefined,
      patchPath: existsSync(patchPath) ? patchPath : undefined,
      summaryPath: parentSummary,
      transcriptPath: explicit.transcriptPath,
      instanceId,
    };
  }

  if (basename(inputPath).toLowerCase() === "summary.json") {
    if (explicit.instanceId) {
      return resolveItemFromRun(inputPath, explicit.instanceId, explicit);
    }
    return {
      ...explicit,
      scope: "run",
      label: basename(dirname(inputPath)),
      runDir: dirname(inputPath),
      summaryPath: inputPath,
    };
  }

  if (extname(inputPath).toLowerCase() === ".jsonl") {
    const isEvents = basename(inputPath).toLowerCase() === "events.jsonl";
    return {
      scope: "item",
      label: basename(inputPath, ".jsonl"),
      eventsPath: isEvents ? inputPath : explicit.eventsPath,
      transcriptPath: isEvents ? explicit.transcriptPath : inputPath,
      summaryPath: explicit.summaryPath,
      patchPath: explicit.patchPath,
      instanceId: explicit.instanceId,
    };
  }

  throw new Error(`Unsupported input: ${inputPath}`);
}

function resolveItemFromRun(summaryPath, instanceId, explicit) {
  const summary = readJson(summaryPath);
  const result = findSummaryResult(summary, instanceId);
  if (!result) {
    throw new Error(`Item ${instanceId} not found in ${summaryPath}`);
  }
  return requestFromSummaryResult(summaryPath, result, explicit);
}

function analyzeRun(request) {
  const summary = readJson(request.summaryPath);
  const results = Array.isArray(summary.results) ? summary.results : [];
  const selected = request.instanceId
    ? results.filter((result) =>
      String(result.instanceId ?? result.instance_id) === request.instanceId
    )
    : results;
  const items = selected.map((result) =>
    analyzeItem(requestFromSummaryResult(request.summaryPath, result, {}))
  );
  const statusCounts = countBy(items, (item) =>
    item.metrics.evaluation.status ?? "unknown"
  );
  const severityCounts = countBy(
    items.flatMap((item) => item.findings),
    (finding) => finding.severity,
  );
  const verdictCounts = countBy(items, (item) => item.deterministicVerdict);
  const totals = items.reduce(
    (sum, item) => ({
      promptTokens: sum.promptTokens + item.metrics.tokens.promptTokens,
      completionTokens:
        sum.completionTokens + item.metrics.tokens.completionTokens,
      totalTokens: sum.totalTokens + item.metrics.tokens.totalTokens,
      cacheHitTokens: sum.cacheHitTokens + item.metrics.tokens.cacheHitTokens,
      cacheMissTokens:
        sum.cacheMissTokens + item.metrics.tokens.cacheMissTokens,
      toolCalls: sum.toolCalls + item.metrics.tools.started,
      durationMs: sum.durationMs + item.metrics.evaluation.durationMs,
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      toolCalls: 0,
      durationMs: 0,
    },
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "run",
    target: {
      runId: summary.runId ?? basename(dirname(request.summaryPath)),
      sourceFiles: [request.summaryPath],
    },
    deterministicVerdict:
      items.some((item) => item.deterministicVerdict === "invalid")
        ? "invalid"
        : items.some((item) =>
            item.deterministicVerdict === "rerun_required"
          )
        ? "rerun_required"
        : items.some((item) => item.deterministicVerdict === "needs_review")
        ? "needs_review"
        : "healthy",
    aggregate: {
      totalItems: items.length,
      statusCounts,
      verdictCounts,
      severityCounts,
      totals: {
        ...totals,
        cacheHitRate: ratio(
          totals.cacheHitTokens,
          totals.cacheHitTokens + totals.cacheMissTokens,
        ),
      },
      rerunRequired: items
        .filter((item) => item.deterministicVerdict === "rerun_required")
        .map((item) => item.target.instanceId),
      invalid: items
        .filter((item) => item.deterministicVerdict === "invalid")
        .map((item) => item.target.instanceId),
      needsReview: items
        .filter((item) => item.deterministicVerdict === "needs_review")
        .map((item) => item.target.instanceId),
    },
    items,
  };
}

function requestFromSummaryResult(summaryPath, result, explicit) {
  const runDir = dirname(summaryPath);
  const instanceId = String(result.instanceId ?? result.instance_id ?? "");
  const itemDir = join(runDir, sanitizePath(instanceId));
  return {
    scope: "item",
    label: instanceId || basename(itemDir),
    instanceId,
    itemDir,
    summaryPath,
    summaryResult: result,
    eventsPath: explicit.eventsPath ??
      resolveResultPath(result.eventsPath, runDir) ??
      existingPath(join(itemDir, "events.jsonl")),
    patchPath: explicit.patchPath ??
      resolveResultPath(result.patchPath, runDir) ??
      existingPath(join(itemDir, "patch.diff")),
    transcriptPath: explicit.transcriptPath,
    worktreePath: result.worktreePath,
  };
}

function analyzeItem(request) {
  const findings = [];
  const summaryResult = request.summaryResult ??
    loadSummaryResult(request.summaryPath, request.instanceId);
  const eventData = readJsonlOptional(request.eventsPath);
  const events = eventData.records;
  const sessionId = selectSessionId(events);
  const transcriptPath = request.transcriptPath ??
    discoverTranscriptPath({
      sessionId,
      worktreePath: request.worktreePath ?? summaryResult?.worktreePath,
      itemDir: request.itemDir,
    });
  const transcriptData = readJsonlOptional(transcriptPath);
  const transcript = transcriptData.records;
  const patch = analyzePatch(request.patchPath ?? summaryResult?.patchPath);

  addParseFindings(findings, eventData, "events");
  addParseFindings(findings, transcriptData, "transcript");

  const protocol = analyzeTranscriptProtocol(transcript, findings);
  const telemetry = analyzeTelemetry(events, findings);
  const messages = analyzeMessages(transcript);
  const tools = analyzeTools(events, transcript, findings);
  const compression = analyzeCompression(events, findings);
  const sessionMemory = analyzeSessionMemory(events, findings);
  const agents = analyzeAgents(events, findings);
  const tokens = analyzeTokens(events);
  const evaluation = analyzeEvaluation(summaryResult, telemetry, patch, findings);

  if (patch.exists && patch.bytes > 0 && tools.mutationCalls > 0 &&
      tools.testCommandCount === 0) {
    findings.push(finding({
      id: "verification.no-test-command",
      severity: "medium",
      category: "verification",
      title: "Code changed without a recorded test command",
      evidence: [{
        source: request.eventsPath ?? transcriptPath ?? "session",
        detail:
          `${tools.mutationCalls} Edit/Write calls and a ${patch.bytes}-byte patch, but no test-like Bash command was observed.`,
      }],
      recommendation:
        "Review the final patch and rerun the most relevant regression tests.",
      confidence: "medium",
    }));
  }

  const repeatedMainCalls = tools.repeatedCalls.filter((repeat) =>
    repeat.agentRole === "main" || repeat.agentId === "main"
  );
  if (telemetry.mainMaxTurnsReached && repeatedMainCalls.length > 0) {
    findings.push(finding({
      id: "agent.max-turns-with-repetition",
      severity: "high",
      category: "agent_behavior",
      title: "The query reached max turns while repeating tool calls",
      evidence: repeatedMainCalls.slice(0, 3).map((repeat) => ({
        source: request.eventsPath ?? "events.jsonl",
        turn: repeat.firstTurn,
        detail:
          `${repeat.toolName} repeated ${repeat.count} times; maximum consecutive streak ${repeat.maxStreak}.`,
      })),
      recommendation:
        "Inspect the repeated-call windows and add a progress or phase-transition guard.",
      confidence: "high",
    }));
  }

  findings.sort((left, right) =>
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    left.id.localeCompare(right.id)
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "item",
    target: {
      instanceId: request.instanceId ?? summaryResult?.instanceId,
      sessionId,
      repo: summaryResult?.repo,
      baseCommit: summaryResult?.baseCommit,
      sourceFiles: unique([
        request.summaryPath,
        request.eventsPath,
        transcriptPath,
        request.patchPath ?? summaryResult?.patchPath,
      ].filter(Boolean)),
    },
    deterministicVerdict: deriveVerdict(findings),
    metrics: {
      evaluation,
      messages,
      protocol,
      telemetry,
      tools,
      tokens,
      compression,
      sessionMemory,
      agents,
      patch,
    },
    findings,
    aiReviewRequired: [
      "Judge whether repeated calls made meaningful progress.",
      "Judge whether the root-cause hypothesis matches the final patch.",
      "Judge whether tests are relevant and sufficient.",
      "Judge whether compression removed a fact needed by later turns.",
      "Do not claim patch correctness without grader evidence.",
    ],
  };
}

function analyzeTranscriptProtocol(entries, findings) {
  const pending = new Map();
  const seenCalls = new Set();
  const seenResults = new Set();
  let assistantToolCalls = 0;
  let toolResults = 0;

  entries.forEach((entry, index) => {
    if (entry?.type !== "message" || !entry.message) {
      return;
    }
    const message = entry.message;
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const id = call?.id;
        if (!id) {
          findings.push(finding({
            id: "protocol.tool-call-without-id",
            severity: "high",
            category: "api_protocol",
            title: "Assistant tool call has no id",
            evidence: [{ source: "transcript", line: index + 1 }],
            recommendation: "Fix transcript serialization for assistant tool calls.",
            confidence: "high",
          }));
          continue;
        }
        assistantToolCalls++;
        if (seenCalls.has(id)) {
          findings.push(finding({
            id: "protocol.duplicate-tool-call-id",
            severity: "high",
            category: "api_protocol",
            title: "Duplicate tool call id",
            evidence: [{
              source: "transcript",
              line: index + 1,
              detail: id,
            }],
            recommendation: "Generate a unique id for every tool call.",
            confidence: "high",
          }));
        }
        seenCalls.add(id);
        pending.set(id, index + 1);
      }
    }

    if (message.role === "tool") {
      toolResults++;
      const id = message.tool_call_id;
      if (!id || !pending.has(id)) {
        findings.push(finding({
          id: "protocol.orphan-tool-result",
          severity: "critical",
          category: "api_protocol",
          title: "Tool result has no preceding matching tool call",
          evidence: [{
            source: "transcript",
            line: index + 1,
            detail: id ? `tool_call_id=${id}` : "missing tool_call_id",
          }],
          recommendation:
            "Repair message projection so tool results remain paired with their assistant tool_calls message.",
          confidence: "high",
        }));
      } else {
        pending.delete(id);
      }
      if (id && seenResults.has(id)) {
        findings.push(finding({
          id: "protocol.duplicate-tool-result",
          severity: "high",
          category: "api_protocol",
          title: "A tool call has multiple tool results",
          evidence: [{ source: "transcript", line: index + 1, detail: id }],
          recommendation: "Persist exactly one terminal result for each tool call.",
          confidence: "high",
        }));
      }
      if (id) {
        seenResults.add(id);
      }
    }
  });

  if (pending.size > 0) {
    findings.push(finding({
      id: "protocol.missing-tool-results",
      severity: "critical",
      category: "api_protocol",
      title: "Assistant tool calls are missing tool results",
      evidence: [...pending.entries()].slice(0, 10).map(([id, line]) => ({
        source: "transcript",
        line,
        detail: id,
      })),
      recommendation:
        "Do not send or persist a later API request until every tool call has a matching result.",
      confidence: "high",
    }));
  }

  return {
    assistantToolCalls,
    toolResults,
    unresolvedToolCalls: pending.size,
  };
}

function analyzeTelemetry(events, findings) {
  const openTools = new Map();
  const queryBalance = new Map();
  let queryStarted = 0;
  let queryFinished = 0;
  let queryFailed = 0;
  let mainMaxTurnsReached = false;
  let subagentMaxTurnsCount = 0;
  let mainMaxTurn = 0;
  let allAgentsMaxTurn = 0;

  events.forEach((event, index) => {
    const agentId = event.agentId ?? "unknown";
    const isMain = event.agentRole === "main" || agentId === "main";
    allAgentsMaxTurn = Math.max(allAgentsMaxTurn, number(event.turn));
    if (isMain) {
      mainMaxTurn = Math.max(mainMaxTurn, number(event.turn));
    }
    if (event.type === "query_started") {
      queryStarted++;
      queryBalance.set(agentId, (queryBalance.get(agentId) ?? 0) + 1);
    } else if (event.type === "query_finished") {
      queryFinished++;
      queryBalance.set(agentId, (queryBalance.get(agentId) ?? 0) - 1);
      if (event.reason === "max_turns") {
        if (isMain) {
          mainMaxTurnsReached = true;
        } else {
          subagentMaxTurnsCount++;
        }
      }
    } else if (event.type === "query_failed") {
      queryFailed++;
      queryBalance.set(agentId, (queryBalance.get(agentId) ?? 0) - 1);
    } else if (event.type === "tool_call_started") {
      openTools.set(`${agentId}:${event.toolCallId}`, {
        line: index + 1,
        toolName: event.toolName,
        turn: event.turn,
      });
    } else if (event.type === "tool_call_finished") {
      openTools.delete(`${agentId}:${event.toolCallId}`);
    }
  });

  const unclosedQueries = [...queryBalance.entries()]
    .filter(([, balance]) => balance > 0);
  if (unclosedQueries.length > 0) {
    findings.push(finding({
      id: "telemetry.unclosed-query",
      severity: "high",
      category: "record_integrity",
      title: "Query start has no terminal event",
      evidence: unclosedQueries.map(([agentId, count]) => ({
        source: "events.jsonl",
        detail: `${agentId}: ${count} unclosed query`,
      })),
      recommendation:
        "Check process termination and ensure query_failed/query_finished is flushed.",
      confidence: "high",
    }));
  }

  if (openTools.size > 0) {
    findings.push(finding({
      id: "telemetry.unclosed-tool-call",
      severity: "high",
      category: "record_integrity",
      title: "Tool telemetry has calls without finish events",
      evidence: [...openTools.values()].slice(0, 10).map((call) => ({
        source: "events.jsonl",
        line: call.line,
        turn: call.turn,
        detail: call.toolName,
      })),
      recommendation:
        "Check interruption handling and flush a terminal tool event.",
      confidence: "high",
    }));
  }

  if (subagentMaxTurnsCount > 0) {
    findings.push(finding({
      id: "agent.subagent-max-turns",
      severity: "medium",
      category: "agent_behavior",
      title: "One or more child Agents exhausted their turn budget",
      evidence: [{
        source: "events.jsonl",
        detail: `${subagentMaxTurnsCount} child query reached max_turns`,
      }],
      recommendation:
        "Review whether child prompts were scoped tightly enough and whether the parent used their partial results.",
      confidence: "high",
    }));
  }

  return {
    queryStarted,
    queryFinished,
    queryFailed,
    mainMaxTurnsReached,
    subagentMaxTurnsCount,
    mainMaxTurn,
    allAgentsMaxTurn,
    unclosedQueries: unclosedQueries.length,
    unclosedToolCalls: openTools.size,
  };
}

function analyzeMessages(entries) {
  const roleCounts = {};
  let messageEntries = 0;
  let stateSnapshots = 0;
  let textChars = 0;
  let reasoningChars = 0;
  let finalAssistantTextChars = 0;
  for (const entry of entries) {
    if (entry?.type === "state_snapshot") {
      stateSnapshots++;
      continue;
    }
    if (entry?.type !== "message" || !entry.message) {
      continue;
    }
    messageEntries++;
    const role = entry.message.role ?? "unknown";
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    textChars += contentLength(entry.message.content);
    reasoningChars += contentLength(entry.message.reasoning_content);
    if (role === "assistant" && contentLength(entry.message.content) > 0) {
      finalAssistantTextChars = contentLength(entry.message.content);
    }
  }
  return {
    entries: entries.length,
    messageEntries,
    stateSnapshots,
    roleCounts,
    textChars,
    reasoningChars,
    finalAssistantTextChars,
  };
}

function analyzeTools(events, transcript, findings) {
  const calls = events
    .map((event, index) => ({ event, line: index + 1 }))
    .filter(({ event }) => event.type === "tool_call_started");
  const counts = countBy(calls, ({ event }) => event.toolName ?? "unknown");
  const durations = events.filter((event) => event.type === "tool_call_finished");
  const resultChars = durations.reduce(
    (sum, event) => sum + number(event.resultChars),
    0,
  );
  const totalDurationMs = durations.reduce(
    (sum, event) => sum + number(event.durationMs),
    0,
  );
  const persistedResults = durations.filter((event) =>
    event.persistedToolResult
  ).length;
  const signatures = new Map();
  const sequences = new Map();
  let testCommandCount = 0;

  for (const call of calls) {
    const event = call.event;
    const signature = `${event.toolName}:${normalizePreview(event.argsPreview)}`;
    const key = `${event.agentId ?? "unknown"}:${signature}`;
    const aggregate = signatures.get(key) ?? {
      agentId: event.agentId,
      agentRole: event.agentRole,
      toolName: event.toolName,
      signature: truncate(signature, 500),
      count: 0,
      firstTurn: event.turn,
      lines: [],
      maxStreak: 0,
    };
    aggregate.count++;
    aggregate.lines.push(call.line);
    signatures.set(key, aggregate);

    const previous = sequences.get(event.agentId);
    const streak = previous?.signature === signature ? previous.streak + 1 : 1;
    sequences.set(event.agentId, { signature, streak });
    aggregate.maxStreak = Math.max(aggregate.maxStreak, streak);

    if (event.toolName === "Bash" && TEST_COMMAND_PATTERN.test(
      String(event.argsPreview ?? ""),
    )) {
      testCommandCount++;
    }
  }

  if (calls.length === 0) {
    for (const entry of transcript) {
      const message = entry?.message;
      if (entry?.type !== "message" || message?.role !== "assistant" ||
          !Array.isArray(message.tool_calls)) {
        continue;
      }
      for (const call of message.tool_calls) {
        const name = call?.function?.name ?? "unknown";
        counts[name] = (counts[name] ?? 0) + 1;
        if (name === "Bash" &&
            TEST_COMMAND_PATTERN.test(String(call?.function?.arguments ?? ""))) {
          testCommandCount++;
        }
      }
    }
  }

  const repeatedCalls = [...signatures.values()]
    .filter((item) => item.count >= 4 || item.maxStreak >= 3)
    .sort((left, right) =>
      right.maxStreak - left.maxStreak || right.count - left.count
    );
  for (const repeated of repeatedCalls.slice(0, 5)) {
    findings.push(finding({
      id: `agent.repeated-tool-call.${slug(repeated.toolName)}`,
      severity: repeated.maxStreak >= 3 ? "medium" : "low",
      category: "agent_behavior",
      title: `Repeated ${repeated.toolName} call signature`,
      evidence: [{
        source: "events.jsonl",
        line: repeated.lines[0],
        turn: repeated.firstTurn,
        detail:
          `${repeated.count} total calls; maximum streak ${repeated.maxStreak}; ${truncate(repeated.signature, 220)}`,
      }],
      recommendation:
        "Inspect whether each repetition changed the hypothesis, code, or verification result.",
      confidence: "medium",
    }));
  }

  return {
    started: calls.length || Object.values(counts).reduce((a, b) => a + b, 0),
    finished: durations.length,
    counts,
    resultChars,
    totalDurationMs,
    persistedResults,
    mutationCalls: number(counts.Edit) + number(counts.Write),
    testCommandCount,
    repeatedCalls: repeatedCalls.map((item) => ({
      agentId: item.agentId,
      agentRole: item.agentRole,
      toolName: item.toolName,
      count: item.count,
      maxStreak: item.maxStreak,
      firstTurn: item.firstTurn,
      lines: item.lines.slice(0, 10),
      signature: item.signature,
    })),
  };
}

function analyzeTokens(events) {
  const usage = events.filter((event) => event.type === "model_usage");
  const promptTokens = sum(usage, "promptTokens");
  const completionTokens = sum(usage, "completionTokens");
  const totalTokens = sum(usage, "totalTokens");
  const cacheHitTokens = sum(usage, "promptCacheHitTokens");
  const cacheMissTokens = sum(usage, "promptCacheMissTokens");
  return {
    requests: usage.length,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheHitTokens,
    cacheMissTokens,
    cacheHitRate: ratio(cacheHitTokens, cacheHitTokens + cacheMissTokens),
    maxPromptTokens: max(usage, "promptTokens"),
  };
}

function analyzeCompression(events, findings) {
  const contexts = events.filter((event) => event.type === "context_ready");
  const started = events.filter((event) =>
    event.type === "auto_compress_started"
  );
  const finished = events.filter((event) =>
    event.type === "auto_compress_finished"
  );
  const compressed = finished.filter((event) =>
    event.status === "compressed"
  );
  const maxEstimatedTokens = max(contexts, "estimatedTokens");
  const maxHistorySnips = max(contexts, "historySnipCount");
  const maxBulkyCompacts = max(contexts, "bulkyToolCompactCount");
  const maxBudgetReplacements = max(
    contexts,
    "toolResultBudgetReplacementCount",
  );
  const invalidOrder = contexts.find((event) =>
    number(event.toolResultCharsAfterBudget) >
      number(event.toolResultCharsBeforeBudget) ||
    number(event.toolResultCharsAfterCompact) >
      number(event.toolResultCharsAfterBudget)
  );
  if (invalidOrder) {
    findings.push(finding({
      id: "context.invalid-size-order",
      severity: "high",
      category: "context_management",
      title: "Projection metrics grow after a compression stage",
      evidence: [{
        source: "events.jsonl",
        turn: invalidOrder.turn,
        detail:
          `before=${invalidOrder.toolResultCharsBeforeBudget}, afterBudget=${invalidOrder.toolResultCharsAfterBudget}, afterCompact=${invalidOrder.toolResultCharsAfterCompact}`,
      }],
      recommendation:
        "Check projection accounting and whether stages measure the same message set.",
      confidence: "high",
    }));
  }
  if (started.length > finished.length) {
    findings.push(finding({
      id: "context.unfinished-auto-compress",
      severity: "high",
      category: "context_management",
      title: "Auto-compress started without a terminal event",
      evidence: [{
        source: "events.jsonl",
        detail: `${started.length} started, ${finished.length} finished`,
      }],
      recommendation: "Check interruption handling around auto-compress.",
      confidence: "high",
    }));
  }
  return {
    contextReadyEvents: contexts.length,
    maxEstimatedTokens,
    autoCompressStarted: started.length,
    autoCompressFinished: finished.length,
    autoCompressApplied: compressed.length,
    maxHistorySnips,
    maxBulkyCompacts,
    maxBudgetReplacements,
    contextsWithProjection:
      contexts.filter((event) =>
        number(event.historySnipCount) > 0 ||
        number(event.bulkyToolCompactCount) > 0 ||
        number(event.toolResultBudgetReplacementCount) > 0
      ).length,
  };
}

function analyzeSessionMemory(events, findings) {
  const started = events.filter((event) =>
    event.type === "session_memory_update_started"
  );
  const finished = events.filter((event) =>
    event.type === "session_memory_update_finished"
  );
  const failed = events.filter((event) =>
    event.type === "session_memory_update_failed"
  );
  if (failed.length > 0) {
    findings.push(finding({
      id: "session-memory.update-failed",
      severity: "medium",
      category: "context_management",
      title: "Session memory update failed",
      evidence: failed.slice(0, 5).map((event) => ({
        source: "events.jsonl",
        detail: truncate(event.error, 300),
      })),
      recommendation:
        "Inspect the memory-model request and preserve the prior valid memory on failure.",
      confidence: "high",
    }));
  }
  if (started.length > finished.length + failed.length) {
    findings.push(finding({
      id: "session-memory.unfinished-update",
      severity: "medium",
      category: "record_integrity",
      title: "Session memory update has no terminal event",
      evidence: [{
        source: "events.jsonl",
        detail:
          `${started.length} started, ${finished.length} finished, ${failed.length} failed`,
      }],
      recommendation: "Check process interruption and event flushing.",
      confidence: "high",
    }));
  }
  return {
    started: started.length,
    updated: finished.filter((event) => event.status === "updated").length,
    skipped: finished.filter((event) => event.status === "skipped").length,
    failed: failed.length,
    lastSummarizedMessageId:
      [...finished].reverse().find((event) => event.lastSummarizedMessageId)
        ?.lastSummarizedMessageId,
  };
}

function analyzeAgents(events, findings) {
  const open = new Map();
  let started = 0;
  let finished = 0;
  let failed = 0;
  events.forEach((event, index) => {
    if (event.type === "agent_started") {
      started++;
      open.set(event.childAgentId, { event, line: index + 1 });
    } else if (event.type === "agent_finished") {
      finished++;
      open.delete(event.childAgentId);
    } else if (event.type === "agent_failed") {
      failed++;
      open.delete(event.childAgentId);
    }
  });
  if (open.size > 0) {
    findings.push(finding({
      id: "agent.unresolved-child",
      severity: "high",
      category: "record_integrity",
      title: "Child Agent has no terminal state",
      evidence: [...open.entries()].slice(0, 10).map(([id, value]) => ({
        source: "events.jsonl",
        line: value.line,
        detail: `${id} (${value.event.childAgentType})`,
      })),
      recommendation:
        "Wait for, cancel, or persist a terminal state for every child Agent.",
      confidence: "high",
    }));
  }
  return {
    started,
    finished,
    failed,
    unresolved: open.size,
  };
}

function analyzePatch(patchPath) {
  const resolved = resolveExisting(patchPath);
  if (!resolved) {
    return {
      path: patchPath,
      exists: false,
      bytes: 0,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    };
  }
  const content = readFileSync(resolved, "utf8");
  const lines = content.split(/\r?\n/);
  return {
    path: resolved,
    exists: true,
    bytes: Buffer.byteLength(content),
    changedFiles: lines.filter((line) => line.startsWith("diff --git ")).length,
    additions: lines.filter((line) =>
      line.startsWith("+") && !line.startsWith("+++")
    ).length,
    deletions: lines.filter((line) =>
      line.startsWith("-") && !line.startsWith("---")
    ).length,
    binary: lines.some((line) =>
      line.startsWith("GIT binary patch") ||
      line.startsWith("Binary files ")
    ),
  };
}

function analyzeEvaluation(summaryResult, telemetry, patch, findings) {
  const status = summaryResult?.status ??
    (telemetry.mainMaxTurnsReached ? "max_turns" : undefined);
  const error = summaryResult?.error;
  if (status === "failed" || status === "skipped") {
    findings.push(finding({
      id: `evaluator.${status}`,
      severity: "high",
      category: status === "skipped" ? "environment" : "evaluator",
      title: `Evaluation status is ${status}`,
      evidence: [{
        source: "summary.json",
        detail: truncate(error || "No error detail recorded", 300),
      }],
      recommendation: "Repair the external failure and rerun this Item.",
      confidence: "high",
      rerunRequired: true,
    }));
  }
  if (status === "max_turns" || telemetry.mainMaxTurnsReached) {
    findings.push(finding({
      id: "agent.max-turns",
      severity: "high",
      category: "agent_behavior",
      title: "The Agent exhausted the query turn budget",
      evidence: [{
        source: "events.jsonl",
        turn: telemetry.mainMaxTurn,
        detail: `main Agent max observed turn=${telemetry.mainMaxTurn}`,
      }],
      recommendation:
        "Review progress by phase and decide whether to tighten exploration or increase the budget.",
      confidence: "high",
    }));
  }
  const expectedPatch = status === "completed" &&
    Array.isArray(summaryResult?.phases) &&
    summaryResult.phases.includes("fix");
  if (expectedPatch && (!patch.exists || patch.bytes === 0)) {
    findings.push(finding({
      id: "patch.missing-after-completed-fix",
      severity: "high",
      category: "patch",
      title: "Completed fix phase produced no patch",
      evidence: [{
        source: "summary.json",
        detail: `status=${status}, phases=${summaryResult.phases.join(",")}`,
      }],
      recommendation:
        "Inspect workspace isolation and patch export, then rerun if no tracked change exists.",
      confidence: "high",
      rerunRequired: true,
    }));
  }
  return {
    status,
    phases: summaryResult?.phases ?? [],
    durationMs: number(summaryResult?.durationMs),
    error,
    changedFiles: summaryResult?.changedFiles ?? [],
  };
}

function addParseFindings(findings, data, label) {
  if (data.errors.length === 0) {
    return;
  }
  findings.push(finding({
    id: `record.${label}-jsonl-parse-errors`,
    severity: "critical",
    category: "record_integrity",
    title: `${label} JSONL contains malformed lines`,
    evidence: data.errors.slice(0, 10).map((error) => ({
      source: data.path ?? label,
      line: error.line,
      detail: error.error,
    })),
    recommendation:
      "Recover or rerun the session before using this record for evaluation.",
    confidence: "high",
  }));
}

function deriveVerdict(findings) {
  if (findings.some((item) =>
    item.category === "record_integrity" && item.severity === "critical" ||
    item.category === "api_protocol" && item.severity === "critical"
  )) {
    return "invalid";
  }
  if (findings.some((item) => item.rerunRequired)) {
    return "rerun_required";
  }
  if (findings.some((item) => SEVERITY_RANK[item.severity] >= 3)) {
    return "needs_review";
  }
  return "healthy";
}

function finding(value) {
  return {
    id: value.id,
    severity: value.severity,
    category: value.category,
    title: value.title,
    evidence: value.evidence ?? [],
    recommendation: value.recommendation,
    confidence: value.confidence,
    ...(value.rerunRequired ? { rerunRequired: true } : {}),
  };
}

function readJsonlOptional(path) {
  const resolved = resolveExisting(path);
  if (!resolved) {
    return { path, records: [], errors: [] };
  }
  const records = [];
  const errors = [];
  const lines = readFileSync(resolved, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      errors.push({
        line: index + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { path: resolved, records, errors };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function loadSummaryResult(summaryPath, instanceId) {
  if (!summaryPath || !existsSync(summaryPath)) {
    return undefined;
  }
  return findSummaryResult(readJson(summaryPath), instanceId);
}

function findSummaryResult(summary, instanceId) {
  const results = Array.isArray(summary?.results) ? summary.results : [];
  if (instanceId) {
    return results.find((result) =>
      String(result.instanceId ?? result.instance_id) === instanceId
    );
  }
  return results.length === 1 ? results[0] : undefined;
}

function findParentSummary(start) {
  let current = resolve(start);
  for (let depth = 0; depth < 4; depth++) {
    const candidate = join(current, "summary.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}

function discoverTranscriptPath({ sessionId, worktreePath, itemDir }) {
  if (!sessionId) {
    return undefined;
  }
  const candidates = [
    worktreePath &&
      join(worktreePath, ".opencat", "transcripts", `${sessionId}.jsonl`),
    itemDir && join(itemDir, `${sessionId}.jsonl`),
    join(process.cwd(), ".opencat", "transcripts", `${sessionId}.jsonl`),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function selectSessionId(events) {
  return events.find((event) =>
    event.type === "query_started" && event.agentRole === "main"
  )?.sessionId ?? events.find((event) => event.sessionId)?.sessionId;
}

function resolveOutputPath(output, request) {
  if (output) {
    const resolved = resolve(output);
    if (extname(resolved).toLowerCase() === ".json") {
      return resolved;
    }
    return join(resolved, "audit-evidence.json");
  }
  const safe = sanitizePath(request.label || "session");
  return resolve(".opencat", "audits", `${safe}-audit-evidence.json`);
}

function summarizeReport(report) {
  if (report.scope === "run") {
    return {
      scope: "run",
      verdict: report.deterministicVerdict,
      itemCount: report.aggregate.totalItems,
      verdictCounts: report.aggregate.verdictCounts,
    };
  }
  return {
    scope: "item",
    instanceId: report.target.instanceId,
    verdict: report.deterministicVerdict,
    findingCount: report.findings.length,
    highestSeverity: report.findings[0]?.severity ?? "none",
  };
}

function resolveOptional(value) {
  return value ? resolve(value) : undefined;
}

function resolveExisting(value) {
  if (!value) {
    return undefined;
  }
  const candidate = resolve(value);
  return existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : undefined;
}

function resolveResultPath(value, base) {
  if (!value) {
    return undefined;
  }
  const candidate = resolve(base, String(value));
  return existsSync(candidate) ? candidate : undefined;
}

function existingPath(path) {
  return existsSync(path) ? path : undefined;
}

function contentLength(value) {
  if (typeof value === "string") {
    return value.length;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) =>
      sum + (typeof item?.text === "string" ? item.text.length : 0), 0);
  }
  return 0;
}

function normalizePreview(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function countBy(values, select) {
  const result = {};
  for (const value of values) {
    const key = String(select(value));
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function sum(values, key) {
  return values.reduce((total, value) => total + number(value?.[key]), 0);
}

function max(values, key) {
  return values.reduce(
    (current, value) => Math.max(current, number(value?.[key])),
    0,
  );
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function unique(values) {
  return [...new Set(values)];
}

function truncate(value, length) {
  const text = String(value ?? "");
  return text.length <= length ? text : `${text.slice(0, length)}...`;
}

function sanitizePath(value) {
  return String(value ?? "session")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 128) || "session";
}

function slug(value) {
  return String(value ?? "unknown").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}
