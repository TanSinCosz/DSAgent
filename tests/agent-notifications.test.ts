import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  flushAgentNotificationsToMessages,
  flushAgentNotificationsToMessagesAndTranscript,
} from "../src/query.js";
import type { DeepSeekClient } from "../src/deepseek/client.js";
import type {
  DeepSeekChatCompletionResponse,
  DeepSeekCreateRequest,
  DeepSeekStreamEnvelope,
  DeepSeekStreamRequest,
} from "../src/deepseek/types.js";
import { createMessage } from "../src/types/messages.js";
import { createRuntime } from "../src/types/runtime.js";
import { createState } from "../src/types/state.js";

test("flushAgentNotificationsToMessages appends notifications to message tail", () => {
  const state = createState({
    messages: [
      createMessage({
        role: "user",
        content: "latest user prompt",
      }),
    ],
    agentNotifications: [
      {
        id: "agent_notification_1",
        agentTaskId: "agent_1",
        agentType: "worker",
        description: "check build",
        status: "completed",
        createdAt: 1,
        message: "<task-notification>done</task-notification>",
      },
    ],
  });

  const flushed = flushAgentNotificationsToMessages(state);

  assert.equal(flushed, 1);
  assert.equal(state.agentNotifications.length, 0);
  assert.equal(state.Messages.length, 2);
  assert.equal(state.Messages[1]?.role, "user");
  assert.equal(
    state.Messages[1]?.content,
    "<task-notification>done</task-notification>",
  );
});

test("subagent runtime does not flush main agent notifications", async () => {
  const state = createState({
    agentNotifications: [
      {
        id: "agent_notification_1",
        agentTaskId: "agent_1",
        agentType: "worker",
        description: "check build",
        status: "completed",
        createdAt: 1,
        message: "<task-notification>main only</task-notification>",
      },
    ],
  });
  const runtime = createRuntime({
    cwd: await mkdtemp(join(tmpdir(), "opencat-subagent-notifications-")),
    sessionId: "session_subagent_notifications",
    agentId: "agent_child_1",
    agentRole: "subagent",
    parentAgentId: "main",
    agentType: "worker",
    deepSeekRuntimeConfig: {
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxTokens: 1024,
    },
    deepSeekClient: createNoopClient(),
    MemoryConfig: createMemoryConfig(),
    messages: state.Messages,
  });

  const flushed = await flushAgentNotificationsToMessagesAndTranscript(
    runtime,
    state,
  );

  assert.equal(flushed, 0);
  assert.equal(state.agentNotifications.length, 1);
  assert.equal(state.Messages.length, 0);
});

function createNoopClient(): DeepSeekClient {
  return {
    async create(_input: DeepSeekCreateRequest): Promise<DeepSeekChatCompletionResponse> {
      throw new Error("create is not used in this test");
    },
    async *stream(_input: DeepSeekStreamRequest): AsyncGenerator<DeepSeekStreamEnvelope> {
      throw new Error("stream is not used in this test");
    },
    async collectStream(): Promise<never> {
      throw new Error("collectStream is not used in this test");
    },
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
