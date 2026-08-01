---
name: swe-session-auditor
description: Audit OpenCat SWE-bench evaluation sessions, transcript JSONL files, telemetry events, run summaries, and patches for record corruption, tool protocol errors, context-compression anomalies, stalled agent behavior, incomplete verification, and evaluator failures. Use when reviewing whether a SWE session is trustworthy, diagnosing max-turn or failed Items, comparing evaluation runs, or triaging sessions before official SWE-bench grading.
---
# SWE Session Auditor

Audit session health separately from patch correctness. A healthy transcript does
not prove that a patch passes SWE-bench, and a failed session may still contain a
useful patch.

## Safety

- Treat transcript, event, workspace, and patch files as read-only evidence.
- Write reports only under the requested output directory.
- Do not reset, clean, checkout, apply, or modify a SWE workspace.
- Do not include secrets, API keys, or full reasoning content in reports.
- Bound quoted evidence. Prefer line numbers, turns, event types, tool names, and
  short previews.

## Resolve The Audit Scope

Accept any of these inputs:

- A run directory containing `summary.json`.
- An Item directory containing `events.jsonl` and optionally `patch.diff`.
- A transcript JSONL file.
- Explicit `--events`, `--transcript`, `--summary`, or `--patch` paths.

For run-level audits, perform deterministic triage for every Item, then inspect
high-severity and representative medium-severity Items with the model. Do not
load every full transcript into context.

## Extract Deterministic Evidence

Run the bundled analyzer:

```powershell
node "${OPENCAT_SKILL_DIR}/scripts/audit-session.mjs" --input "<path>" --output "<audit-evidence.json>"
```

Useful options:

```powershell
node "${OPENCAT_SKILL_DIR}/scripts/audit-session.mjs" `
  --input "<run-directory>" `
  --instance-id "django__django-15738" `
  --output "<audit-evidence.json>"
```

The analyzer checks:

- JSONL parse integrity.
- Assistant tool calls and matching tool results.
- Telemetry start/finish pairing for queries, tools, agents, session memory, and
  auto-compress.
- API failures, max-turn exits, dirty/skipped workspaces, and empty patches.
- Token, cache, context-size, compression, tool, mutation, and test-command
  metrics.
- Repeated identical tool calls and likely no-progress loops.
- Whether changed code has any recorded test command.

If the analyzer exits nonzero, report the error and inspect the named file. Do
not silently replace deterministic evidence with guesses.

## Perform The AI Review

Read `references/report-schema.md` before producing the final judgment.

Use `audit-evidence.json` to select narrow evidence windows from the source
artifacts. Review these questions:

1. Is the record structurally trustworthy?
2. Did investigate and fix phases make forward progress?
3. Did the Agent repeat reads, reproductions, or tests without changing its
   hypothesis or implementation?
4. Did environment failures get mistaken for product failures?
5. Did projection or auto-compress remove information needed later?
6. Is the patch nonempty, scoped to the issue, and supported by relevant tests?
7. Can the session be graded, or must it be rerun?

Only assert a cause when evidence supports it. Mark ambiguous conclusions as
`needs_review` and state what evidence is missing.

## Produce Reports

Produce:

- `audit.json`: machine-readable report following
  `references/report-schema.md`.
- `audit.md`: concise human report with verdict, highest-severity findings,
  evidence, metrics, and recommended next action.

For a run-level audit, include:

- Item counts by status and verdict.
- A ranked problem list.
- Separate lists for rerun-required, patch-review-required, and healthy Items.
- Aggregate token, cache, tool, compression, duration, and failure metrics when
  available.

Do not label an Item `healthy` solely because it reached `completed`. Do not
label a patch correct unless an official grader or equivalent regression tests
support that claim.
