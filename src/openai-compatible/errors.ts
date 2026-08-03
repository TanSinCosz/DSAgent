import type { ModelProvider } from "./provider.js";

export type OpenAICompatibleApiErrorCategory =
  | "format_error"
  | "authentication_failed"
  | "insufficient_balance"
  | "parameter_error"
  | "rate_limited"
  | "server_error"
  | "server_busy"
  | "unknown";

type ApiErrorInfo = {
  category: OpenAICompatibleApiErrorCategory;
  title: string;
  cause: string;
  suggestion: string;
  retryable: boolean;
};

export class OpenAICompatibleApiError extends Error {
  readonly status?: number;
  readonly category: OpenAICompatibleApiErrorCategory;
  readonly causeText: string;
  readonly suggestion: string;
  readonly retryable: boolean;
  readonly originalMessage?: string;
  readonly provider: ModelProvider;

  constructor(input: {
    provider: ModelProvider;
    providerDisplayName: string;
    status?: number;
    originalMessage?: string;
    cause?: unknown;
  }) {
    const info = classifyApiError(input.status);
    const lines = [
      `${input.providerDisplayName} API error: ${info.title}`,
      `Cause: ${info.cause}`,
      `Suggestion: ${info.suggestion}`,
      `Retryable: ${info.retryable ? "yes" : "no"}`,
      input.originalMessage ? `Original: ${input.originalMessage}` : undefined,
    ].filter(Boolean);

    super(
      lines.join("\n"),
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "OpenAICompatibleApiError";
    this.status = input.status;
    this.category = info.category;
    this.causeText = info.cause;
    this.suggestion = info.suggestion;
    this.retryable = info.retryable;
    this.originalMessage = input.originalMessage;
    this.provider = input.provider;
  }
}

export function normalizeOpenAICompatibleApiError(
  error: unknown,
  options: {
    provider: ModelProvider;
    providerDisplayName: string;
  },
): Error {
  if (error instanceof OpenAICompatibleApiError) {
    return error;
  }

  const status = readErrorStatus(error);
  if (status === undefined) {
    return error instanceof Error ? error : new Error(String(error));
  }

  return new OpenAICompatibleApiError({
    ...options,
    status,
    originalMessage: readErrorMessage(error),
    cause: error,
  });
}

export function formatOpenAICompatibleErrorForUser(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyApiError(status: number | undefined): ApiErrorInfo {
  switch (status) {
    case 400:
      return {
        category: "format_error",
        title: "400 - Request format error",
        cause: "The request body format is invalid.",
        suggestion: "Check the provider profile, request payload, and schema conversion.",
        retryable: false,
      };
    case 401:
      return {
        category: "authentication_failed",
        title: "401 - Authentication failed",
        cause: "The API key is missing, invalid, or rejected.",
        suggestion: "Check the configured provider API key and restart the process.",
        retryable: false,
      };
    case 402:
      return {
        category: "insufficient_balance",
        title: "402 - Insufficient balance",
        cause: "The provider account balance is insufficient.",
        suggestion: "Recharge the provider account or switch to a funded key.",
        retryable: false,
      };
    case 422:
      return {
        category: "parameter_error",
        title: "422 - Parameter error",
        cause: "One or more request parameters are invalid.",
        suggestion: "Check the model, tools, message fields, and provider extensions.",
        retryable: false,
      };
    case 429:
      return {
        category: "rate_limited",
        title: "429 - Rate limit reached",
        cause: "The provider request rate reached the account limit.",
        suggestion: "Reduce concurrency or retry with backoff.",
        retryable: true,
      };
    case 500:
      return {
        category: "server_error",
        title: "500 - Server error",
        cause: "The provider reported an internal server error.",
        suggestion: "Retry later and preserve request metadata if the error persists.",
        retryable: true,
      };
    case 503:
      return {
        category: "server_busy",
        title: "503 - Server busy",
        cause: "The provider is currently overloaded.",
        suggestion: "Retry later with backoff.",
        retryable: true,
      };
    default:
      return {
        category: "unknown",
        title: status ? `${status} - API error` : "API error",
        cause: "The model API request failed.",
        suggestion: "Inspect the original error and provider request context.",
        retryable: false,
      };
  }
}

function readErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const direct = error.status ?? error.statusCode ?? error.code;
  if (typeof direct === "number") {
    return direct;
  }
  if (typeof direct === "string" && /^\d+$/.test(direct)) {
    return Number(direct);
  }
  return undefined;
}

function readErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error.message === "string") {
    return error.message;
  }
  if (isRecord(error.error) && typeof error.error.message === "string") {
    return error.error.message;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
