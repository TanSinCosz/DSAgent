import assert from "node:assert/strict";
import test from "node:test";

import { flushAgentNotificationsToMessages } from "../src/query.js";
import { createMessage } from "../src/types/messages.js";
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
