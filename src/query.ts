import { createDeepSeekClient } from "./deepseek/client.js";
import type {
  DeepSeekAssistantMessage,
  DeepSeekCreateRequest,
  DeepSeekDeltaToolCall,
  DeepSeekMessage,
  DeepSeekStreamEnvelope,
  DeepSeekToolCall,
  DeepSeekToolDefinition,
} from "./deepseek/types.js";
import {
  buildMainSystemPrompt,
  type MainSystemPrompt,
  type MainSystemPromptOptions,
} from "./system-prompt.js";
import type { Runtime, State } from "./types/type.js";
import type { Tool, Tools } from "./Tools/types.js";

export type QueryEvent =
  | { type: "context_ready"; prompt: MainSystemPrompt; messages: DeepSeekMessage[] }
  | { type: "model_stream_start"; turn: number }
  | { type: "model_stream_event"; event: DeepSeekStreamEnvelope }
  | { type: "assistant_text_delta"; text: string }
  | { type: "assistant_message"; message: DeepSeekAssistantMessage }
  | { type: "tool_use"; toolCall: DeepSeekToolCall }
  | { type: "tool_result"; toolCall: DeepSeekToolCall; message: DeepSeekMessage }
  | { type: "turn_end"; turn: number; hasToolUse: boolean }
  | { type: "done"; reason: "completed" | "max_turns" };

export interface QueryOptions {
  maxTurns?: number;
  promptOptions?: MainSystemPromptOptions;
  messagesForQueryBuilder?: MessagesForQueryBuilder;
}

export interface MessagesForQuery {
  prompt: MainSystemPrompt;
  messages: DeepSeekMessage[];
}

export interface MessageCompressionStep {
  name: string;
  apply(
    messages: DeepSeekMessage[],
    context: MessageCompressionContext,
  ): Promise<DeepSeekMessage[]> | DeepSeekMessage[];
}

export interface MessageCompressionContext {
  runtime: Runtime;
  state: State;
  prompt: MainSystemPrompt;
}

export class MessagesForQueryBuilder {
  constructor(
    private readonly steps: readonly MessageCompressionStep[] = [],
    private readonly promptOptions: MainSystemPromptOptions = {},
  ) {}

  async build(runtime: Runtime, state: State): Promise<MessagesForQuery> {
    await this.applyAutoCompression(runtime, state);

    const prompt = await buildMainSystemPrompt(runtime, state, {
      ...this.promptOptions,
      model: this.promptOptions.model ?? runtime.deepSeekRuntimeConfig.model,
    });

    let messages: DeepSeekMessage[] = [
      {
        role: "system",
        content: prompt.systemPrompt,
      },
      ...prompt.modelMessages,
    ];

    for (const step of this.steps) {
      messages = await step.apply(messages, { runtime, state, prompt });
    }

    return { prompt, messages };
  }

  protected async applyAutoCompression(
    _runtime: Runtime,
    _state: State,
  ): Promise<void> {
    // Reserved for automatic compaction that mutates state.Messages directly.
    // Projection-only compression belongs in `steps`; durable auto compaction
    // belongs here so the authoritative transcript is updated before querying.
  }
}

export async function* query(
  runtime: Runtime,
  state: State,
  options: QueryOptions = {},
): AsyncGenerator<QueryEvent, void, void> {
  yield* _query(runtime, state, options);
}

export async function* _query(
  runtime: Runtime,
  state: State,
  options: QueryOptions = {},
): AsyncGenerator<QueryEvent, void, void> {
  const maxTurns = options.maxTurns ?? 10;
  const messagesForQueryBuilder =
    options.messagesForQueryBuilder ??
    new MessagesForQueryBuilder([], options.promptOptions);
  const client = createDeepSeekClient({
    config: {
      ...runtime.deepSeekRuntimeConfig,
      systemPrompt: undefined,
    },
  });

  for (let turn = 1; turn <= maxTurns; turn++) {
    const messagesForQuery = await messagesForQueryBuilder.build(runtime, state);
    yield {
      type: "context_ready",
      prompt: messagesForQuery.prompt,
      messages: messagesForQuery.messages,
    };

    const request = await createStreamRequest(runtime, messagesForQuery.messages);
    yield { type: "model_stream_start", turn };

    const assistantMessage = createEmptyAssistantMessage();

    for await (const event of client.stream(request)) {
      yield { type: "model_stream_event", event };

      if (!event.chunk) {
        continue;
      }

      for (const choice of event.chunk.choices) {
        const delta = choice.delta;

        if (typeof delta.content === "string") {
          assistantMessage.content =
            (assistantMessage.content ?? "") + delta.content;
          yield { type: "assistant_text_delta", text: delta.content };
        }

        if (typeof delta.reasoning_content === "string") {
          assistantMessage.reasoning_content =
            (assistantMessage.reasoning_content ?? "") +
            delta.reasoning_content;
        }

        if (delta.tool_calls?.length) {
          assistantMessage.tool_calls ??= [];
          mergeToolCallDeltas(assistantMessage.tool_calls, delta.tool_calls);
        }
      }
    }

    normalizeAssistantMessage(assistantMessage);
    state.Messages.push({ message: assistantMessage });
    runtime.toolUseContext.messages = state.Messages;
    yield { type: "assistant_message", message: assistantMessage };

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      yield { type: "turn_end", turn, hasToolUse: false };
      yield { type: "done", reason: "completed" };
      return;
    }

    for (const toolCall of toolCalls) {
      yield { type: "tool_use", toolCall };
      const toolResultMessage = await executeToolCall(
        toolCall,
        runtime.tools,
        runtime,
      );
      state.Messages.push({ message: toolResultMessage });
      runtime.toolUseContext.messages = state.Messages;
      yield {
        type: "tool_result",
        toolCall,
        message: toolResultMessage,
      };
    }

    yield { type: "turn_end", turn, hasToolUse: true };
  }

  yield { type: "done", reason: "max_turns" };
}

async function createStreamRequest(
  runtime: Runtime,
  messages: DeepSeekMessage[],
): Promise<DeepSeekCreateRequest & { stream: true }> {
  return {
    model: runtime.deepSeekRuntimeConfig.model as DeepSeekCreateRequest["model"],
    messages,
    max_tokens: runtime.deepSeekRuntimeConfig.maxTokens,
    reasoning_effort:
      runtime.deepSeekRuntimeConfig.reasoningEffort === "high" ||
      runtime.deepSeekRuntimeConfig.reasoningEffort === "max"
        ? runtime.deepSeekRuntimeConfig.reasoningEffort
        : undefined,
    tools: await toDeepSeekTools(runtime.tools),
    tool_choice: runtime.tools.length > 0 ? "auto" : undefined,
    stream: true,
  };
}

async function toDeepSeekTools(
  tools: Tools,
): Promise<DeepSeekToolDefinition[] | undefined> {
  if (tools.length === 0) {
    return undefined;
  }

  return Promise.all(
    tools.map(async (tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: await tool.description(),
        parameters: {
          type: "object",
          additionalProperties: true,
        },
        strict: tool.strict,
      },
    })),
  );
}

function createEmptyAssistantMessage(): DeepSeekAssistantMessage {
  return {
    role: "assistant",
    content: "",
    reasoning_content: null,
    tool_calls: [],
  };
}

function normalizeAssistantMessage(message: DeepSeekAssistantMessage): void {
  if (!message.content) {
    message.content = message.tool_calls?.length ? null : "";
  }

  if (message.tool_calls?.length === 0) {
    delete message.tool_calls;
  }
}

function mergeToolCallDeltas(
  target: DeepSeekToolCall[],
  deltas: DeepSeekDeltaToolCall[],
): void {
  for (const delta of deltas) {
    const index = delta.index ?? 0;

    while (target.length <= index) {
      target.push({
        id: "",
        type: "function",
        function: {
          name: "",
          arguments: "",
        },
      });
    }

    const toolCall = target[index];

    if (delta.id) {
      toolCall.id = delta.id;
    }

    if (delta.type) {
      toolCall.type = delta.type;
    }

    if (delta.function?.name) {
      toolCall.function.name = delta.function.name;
    }

    if (typeof delta.function?.arguments === "string") {
      toolCall.function.arguments += delta.function.arguments;
    }
  }
}

async function executeToolCall(
  toolCall: DeepSeekToolCall,
  tools: Tools,
  runtime: Runtime,
): Promise<DeepSeekMessage> {
  const tool = findTool(tools, toolCall.function.name);

  if (!tool) {
    return createToolResultMessage(
      toolCall.id,
      `Tool not found: ${toolCall.function.name}`,
    );
  }

  try {
    const parsedInput = parseToolArguments(toolCall.function.arguments);
    const validation = validateToolInput(tool, parsedInput);

    if (validation.ok === false) {
      return createToolResultMessage(toolCall.id, validation.error);
    }

    const output = await tool.call(
      validation.input as Record<string, unknown>,
      runtime.toolUseContext,
    );
    return createToolResultMessage(toolCall.id, stringifyToolResult(output));
  } catch (error) {
    return createToolResultMessage(toolCall.id, stringifyError(error));
  }
}

function findTool(tools: Tools, name: string): Tool | undefined {
  return tools.find((tool) => tool.name === name);
}

function parseToolArguments(raw: string): unknown {
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw);
}

function validateToolInput(
  tool: Tool,
  input: unknown,
): { ok: true; input: unknown } | { ok: false; error: string } {
  const schema =
    typeof tool.inputSchema === "function" ? tool.inputSchema() : tool.inputSchema;
  const result = schema.safeParse(input);

  if (!result.success) {
    return {
      ok: false,
      error: result.error.message,
    };
  }

  return {
    ok: true,
    input: result.data,
  };
}

function createToolResultMessage(
  toolCallId: string,
  content: string,
): DeepSeekMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content,
  };
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
