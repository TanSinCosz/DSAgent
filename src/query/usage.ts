import type { ModelUsage } from "../openai-compatible/types.js";
import type { Runtime, RuntimeUsageStats } from "../types/runtime.js";

export function recordModelUsage(
  runtime: Runtime,
  usage: ModelUsage,
): RuntimeUsageStats {
  const cacheHitTokens = getPromptCacheHitTokens(usage);
  const cacheMissTokens = getPromptCacheMissTokens(usage, cacheHitTokens);
  runtime.usage.promptTokens += usage.prompt_tokens ?? 0;
  runtime.usage.completionTokens += usage.completion_tokens ?? 0;
  runtime.usage.totalTokens += usage.total_tokens ?? 0;
  runtime.usage.promptCacheHitTokens += cacheHitTokens;
  runtime.usage.promptCacheMissTokens += cacheMissTokens;

  return snapshotRuntimeUsage(runtime);
}

export function getPromptCacheHitTokens(usage: ModelUsage): number {
  return usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
}

export function getPromptCacheMissTokens(
  usage: ModelUsage,
  cacheHitTokens = getPromptCacheHitTokens(usage),
): number {
  return usage.prompt_cache_miss_tokens ??
    Math.max(0, usage.prompt_tokens - cacheHitTokens);
}

export function snapshotRuntimeUsage(runtime: Runtime): RuntimeUsageStats {
  return { ...runtime.usage };
}
