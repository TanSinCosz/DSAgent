import assert from "node:assert/strict";
import test from "node:test";

import type { MemoryTool } from "../src/Memory/Memory.js";
import { buildMessagesForQuery } from "../src/query/messages.js";
import { createMessage } from "../src/types/messages.js";
import { createRuntime } from "../src/types/runtime.js";
import { createState } from "../src/types/state.js";

test("only MemorySave is exposed as a long-term memory tool", async () => {
  const fakeMemory = createFakeMemory();
  const state = createState();
  const runtime = createRuntime({
    deepSeekRuntimeConfig: createDeepSeekConfig(),
    MemoryConfig: createMemoryConfig(),
    longTermMemory: fakeMemory as unknown as MemoryTool,
    longTermMemoryConfig: {
      userId: "user-1",
    },
  });

  const searchTool = runtime.tools.find((tool) => tool.name === "MemorySearch");
  const saveTool = runtime.tools.find((tool) => tool.name === "MemorySave");
  assert.equal(searchTool, undefined);
  assert.ok(saveTool);

  const saveOutput = await saveTool.call(
    { memory: "User prefers compact architecture notes." },
    runtime.toolUseContext,
    runtime,
    state,
  ) as { results: Array<{ memory: string }> };

  assert.equal(saveOutput.results[0]?.memory, "User prefers compact architecture notes.");
  assert.equal(fakeMemory.searchCalls.length, 0);
  assert.equal(fakeMemory.addCalls[0]?.config.filters?.user_id, "user-1");
  assert.equal(fakeMemory.addCalls[0]?.config.infer, false);
});

test("buildMessagesForQuery injects long-term memory as projection only", async () => {
  const fakeMemory = createFakeMemory();
  const state = createState({
    messages: [
      createMessage({
        role: "user",
        content: "What conventions should I follow in this repo?",
      }),
    ],
  });
  const runtime = createRuntime({
    deepSeekRuntimeConfig: createDeepSeekConfig(),
    MemoryConfig: createMemoryConfig(),
    longTermMemory: fakeMemory as unknown as MemoryTool,
    longTermMemoryConfig: {
      autoInject: true,
      userId: "user-1",
    },
    messages: state.Messages,
  });

  const projection = await buildMessagesForQuery(runtime, state);

  assert.equal(state.Messages.length, 1);
  assert.equal(projection.messages[0]?.role, "system");
  assert.equal(projection.messages[1]?.role, "user");
  assert.match(projection.messages[1]?.content ?? "", /<long_term_memory>/);
  assert.match(
    projection.messages[1]?.content ?? "",
    /repo-grounded implementation notes/,
  );
  assert.equal(projection.messages[2]?.role, "user");
  assert.equal(
    projection.messages[2]?.content,
    "What conventions should I follow in this repo?",
  );
});

function createFakeMemory() {
  const fakeMemory = {
    searchCalls: [] as Array<{ query: string; config: any }>,
    addCalls: [] as Array<{ messages: unknown; config: any }>,
    async search(query: string, config: any) {
      this.searchCalls.push({ query, config });
      return {
        results: [
          {
            id: "mem_1",
            memory: "User prefers repo-grounded implementation notes.",
            score: 0.9,
          },
        ],
      };
    },
    async add(messages: unknown, config: any) {
      this.addCalls.push({ messages, config });
      return {
        results: [
          {
            id: "mem_saved",
            memory: String(messages),
            metadata: { event: "ADD" },
          },
        ],
      };
    },
  };

  return fakeMemory;
}

function createDeepSeekConfig() {
  return {
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    maxTokens: 1024,
  } as const;
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
