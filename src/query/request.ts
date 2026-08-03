import type {
  ModelCreateRequest,
  ModelMessage,
  ModelStreamRequest,
  ModelToolDefinition,
} from "../openai-compatible/types.js";
import type { Runtime } from "../types/runtime.js";
import type { JSONSchemaObject, Tool, Tools } from "../Tools/types.js";
import { z } from "zod";

export async function createStreamRequest(
  runtime: Runtime,
  messages: ModelMessage[],
): Promise<ModelStreamRequest> {
  return {
    model: runtime.modelRuntimeConfig.model as ModelCreateRequest["model"],
    user_id: runtime.modelRuntimeConfig.userId,
    messages,
    signal: runtime.toolUseContext.abortController.signal,
    max_tokens: runtime.modelRuntimeConfig.maxTokens,
    reasoning_effort:
      runtime.modelRuntimeConfig.reasoningEffort === "high" ||
      runtime.modelRuntimeConfig.reasoningEffort === "max"
        ? runtime.modelRuntimeConfig.reasoningEffort
        : undefined,
    tools: await toModelTools(runtime.tools),
    tool_choice: runtime.tools.length > 0 ? "auto" : undefined,
    stream: true,
    stream_options: {
      include_usage: true,
    },
  };
}

async function toModelTools(
  tools: Tools,
): Promise<ModelToolDefinition[] | undefined> {
  if (tools.length === 0) {
    return undefined;
  }

  return Promise.all(
    tools.map(async (tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: await tool.description(),
        parameters: toToolInputParameters(tool),
        strict: tool.strict,
      },
    })),
  );
}

function toToolInputParameters(tool: Tool): JSONSchemaObject {
  if (tool.inputJsonSchema) {
    return tool.inputJsonSchema;
  }

  const schema =
    typeof tool.inputSchema === "function" ? tool.inputSchema() : tool.inputSchema;

  try {
    return z.toJSONSchema(schema) as JSONSchemaObject;
  } catch {
    return {
      type: "object",
      additionalProperties: true,
    };
  }
}
