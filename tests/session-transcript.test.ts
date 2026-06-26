import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DeepSeekClient } from "../src/deepseek/client.js";
import type {
  DeepSeekCreateRequest,
  DeepSeekStreamEnvelope,
  DeepSeekStreamRequest,
} from "../src/deepseek/types.js";
import { query } from "../src/query.js";
import { projectMessagesWithAutoCompress } from "../src/auto-compress/index.js";
import {
  loadStateFromTranscript,
  recordTranscriptMessage,
  recordTranscriptStateSnapshot,
} from "../src/transcript/persistence.js";
import { createMessage } from "../src/types/messages.js";
import { createRuntime } from "../src/types/runtime.js";
import { createState } from "../src/types/state.js";

test("transcript store restores messages and latest state snapshot", async () => {
  const runtime = createRuntime({
    cwd: await mkdtemp(join(tmpdir(), "opencat-transcript-")),
    sessionId: "session_restore_test",
    deepSeekRuntimeConfig: createRuntimeConfig(),
    deepSeekClient: createNoopClient(),
    MemoryConfig: createMemoryConfig(),
  });
  const state = createState({ mode: "plan" });
  const userMessage = createMessage({
    role: "user",
    content: "remember this user prompt",
  });

  state.Messages.push(userMessage);
  state.sessionMemory.status = "ready";
  state.sessionMemory.content = "# Session Title\nPersisted transcript";

  await recordTranscriptMessage(runtime, userMessage);
  await recordTranscriptStateSnapshot(runtime, state, "manual");

  const restored = await loadStateFromTranscript(runtime.transcriptStore!);

  assert.ok(restored);
  assert.equal(restored.Messages.length, 1);
  assert.equal(restored.Messages[0]?.id, userMessage.id);
  assert.equal(restored.mode, "plan");
  assert.equal(restored.sessionMemory.status, "ready");
  assert.match(restored.sessionMemory.content, /Persisted transcript/);
});

test("query appends assistant messages to transcript", async () => {
  const createRequests: DeepSeekCreateRequest[] = [];
  const streamRequests: DeepSeekStreamRequest[] = [];
  const runtime = createRuntime({
    cwd: await mkdtemp(join(tmpdir(), "opencat-query-transcript-")),
    sessionId: "session_query_test",
    deepSeekRuntimeConfig: createRuntimeConfig(),
    deepSeekClient: {
      async create(input) {
        createRequests.push(input);
        throw new Error("create is not used in this test");
      },
      async *stream(input) {
        streamRequests.push(input);
        yield createAssistantChunk("OK");
        yield {
          chunk: null,
          raw: "[DONE]",
          done: true,
        };
      },
      async collectStream() {
        throw new Error("collectStream is not used in this test");
      },
    },
    MemoryConfig: createMemoryConfig(),
  });
  const state = createState();
  const userMessage = createMessage({
    role: "user",
    content: "say ok",
  });

  state.Messages.push(userMessage);
  await recordTranscriptMessage(runtime, userMessage);

  for await (const _event of query(runtime, state, { maxTurns: 1 })) {
    // Drain the query stream so the assistant message is finalized and recorded.
  }

  const entries = await runtime.transcriptStore!.load();
  const messageEntries = entries.filter((entry) => entry.type === "message");

  assert.equal(createRequests.length, 0);
  assert.equal(streamRequests.length, 1);
  assert.equal(messageEntries.length, 2);
  assert.equal(messageEntries[0]?.message.role, "user");
  assert.equal(messageEntries[1]?.message.role, "assistant");
  assert.equal(messageEntries[1]?.message.content, "OK");
});

test("subagent transcript store uses the concrete agent id", async () => {
  const runtime = createRuntime({
    cwd: await mkdtemp(join(tmpdir(), "opencat-subagent-transcript-")),
    sessionId: "session_with_subagents",
    agentId: "agent_child_1",
    agentRole: "subagent",
    parentAgentId: "main",
    agentType: "worker",
    deepSeekRuntimeConfig: createRuntimeConfig(),
    deepSeekClient: createNoopClient(),
    MemoryConfig: createMemoryConfig(),
  });
  const message = createMessage({
    role: "user",
    content: "child prompt",
  });

  await recordTranscriptMessage(runtime, message);

  assert.match(runtime.transcriptStore!.path, /session_with_subagents/);
  assert.match(runtime.transcriptStore!.path, /subagents/);
  assert.match(runtime.transcriptStore!.path, /agent-agent_child_1\.jsonl$/);

  const raw = await readFile(runtime.transcriptStore!.path, "utf8");
  const entry = JSON.parse(raw.trim());

  assert.equal(entry.agentId, "agent_child_1");
  assert.equal(entry.agentRole, "subagent");
  assert.equal(entry.parentAgentId, "main");
  assert.equal(entry.agentType, "worker");
});

test("transcript restore hydrates only post auto-compress messages by default", async () => {
  const runtime = createRuntime({
    cwd: await mkdtemp(join(tmpdir(), "opencat-compact-transcript-")),
    sessionId: "session_compact_restore_test",
    deepSeekRuntimeConfig: createRuntimeConfig(),
    deepSeekClient: createNoopClient(),
    MemoryConfig: createMemoryConfig(),
  });
  const first = createMessage({ role: "user", content: "old context 1" });
  const second = createMessage({ role: "assistant", content: "old context 2" });
  const third = createMessage({ role: "user", content: "recent tail" });
  const state = createState({
    messages: [first, second],
    autoCompress: {
      summaries: [
        {
          id: "autocompress_test_summary",
          content: "compressed earlier conversation",
          fromMessageId: first.id,
          throughMessageId: second.id,
          messageCount: 2,
          createdAt: 1,
        },
      ],
      activeSummaryId: "autocompress_test_summary",
      sessionMemoryUpdated: true,
    },
  });

  await recordTranscriptMessage(runtime, first);
  await recordTranscriptMessage(runtime, second);
  await recordTranscriptStateSnapshot(runtime, state, "auto_compress");
  await recordTranscriptMessage(runtime, third);

  const restored = await loadStateFromTranscript(runtime.transcriptStore!);
  const full = await loadStateFromTranscript(runtime.transcriptStore!, {
    hydrate: "full",
  });

  assert.ok(restored);
  assert.equal(restored.Messages.length, 1);
  assert.equal(restored.Messages[0]?.id, third.id);
  assert.equal(restored.autoCompress.activeSummaryId, "autocompress_test_summary");

  const projected = projectMessagesWithAutoCompress(restored);
  assert.equal(projected.length, 2);
  assert.match(projected[0]?.content ?? "", /compressed earlier conversation/);
  assert.equal(projected[1]?.id, third.id);

  assert.ok(full);
  assert.equal(full.Messages.length, 3);
});

function createAssistantChunk(text: string): DeepSeekStreamEnvelope {
  return {
    raw: text,
    done: false,
    chunk: {
      id: "assistant-chunk",
      object: "chat.completion.chunk",
      created: 0,
      model: "deepseek-v4-flash",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: text,
          },
          finish_reason: "stop",
        },
      ],
    },
  };
}

function createNoopClient(): DeepSeekClient {
  return {
    async create() {
      throw new Error("create is not used in this test");
    },
    async *stream() {
      throw new Error("stream is not used in this test");
    },
    async collectStream() {
      throw new Error("collectStream is not used in this test");
    },
  };
}

function createRuntimeConfig() {
  return {
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    maxTokens: 1024,
  };
}

function createMemoryConfig() {
  return {
    embedder: {
      provider: "test",
      config: {},
    },
    vectorStore: {
      provider: "test",
      config: {},
    },
    llm: {
      provider: "test",
      config: {},
    },
  };
}
