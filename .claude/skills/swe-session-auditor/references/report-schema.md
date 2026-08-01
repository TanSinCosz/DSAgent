# Audit Report Schema

Use this schema for `audit.json`. Keep evidence compact and source-addressable.

```json
{
  "schemaVersion": 1,
  "scope": "item",
  "target": {
    "instanceId": "django__django-15738",
    "sessionId": "session_swe_serial_xxx",
    "sourceFiles": []
  },
  "verdict": "healthy | needs_review | invalid | rerun_required",
  "confidence": "high | medium | low",
  "summary": "One concise evidence-backed conclusion.",
  "metrics": {},
  "findings": [
    {
      "id": "agent.repeated-verification",
      "severity": "critical | high | medium | low | info",
      "category": "record_integrity | api_protocol | evaluator | environment | agent_behavior | context_management | verification | patch",
      "title": "Short title",
      "evidence": [
        {
          "source": "events.jsonl",
          "line": 120,
          "turn": 81,
          "detail": "Short bounded fact"
        }
      ],
      "impact": "Why this affects trust, efficiency, or correctness.",
      "recommendation": "Concrete next action.",
      "confidence": "high | medium | low"
    }
  ],
  "limitations": []
}
```

For a run-level report, set `scope` to `run` and add:

```json
{
  "aggregate": {
    "totalItems": 300,
    "verdictCounts": {},
    "statusCounts": {},
    "rerunRequired": [],
    "patchReviewRequired": [],
    "healthy": []
  },
  "items": []
}
```

## Verdict Rules

- `invalid`: The record cannot be trusted because of malformed JSONL, orphan
  tool messages, missing terminal protocol events, or irreconcilable metadata.
- `rerun_required`: The run ended because of API failure, dirty/missing
  workspace, missing patch for a fix task, or another external interruption.
- `needs_review`: The record is usable but shows max-turn behavior, repetition,
  weak verification, ambiguous compression effects, or an unvalidated patch.
- `healthy`: No high-severity session defect is found, the patch is present when
  expected, and relevant verification is recorded.

Patch correctness remains `unknown` until official SWE-bench grading or
equivalent tests complete.

## Evidence Rules

- Cite JSONL line numbers or event turns whenever possible.
- Quote at most 300 characters from prompts, tool arguments, results, or final
  answers.
- Do not copy `reasoning_content`.
- Distinguish observed facts from model inferences.
- Do not infer that compression caused a later mistake merely because both
  occurred. Require a missing fact, a changed behavior, or another direct link.
- Treat repeated commands as a heuristic unless they are identical and make no
  observable progress.
