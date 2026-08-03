# Model configuration

OpenCat reads model profiles from:

```text
~/.opencat/config.yaml
```

Use `OPENCAT_CONFIG_PATH` to select another file.

## Named profiles

```yaml
activeProfile: ark-coding

profiles:
  ark-coding:
    provider: volcengine
    apiKeyEnv: ARK_API_KEY
    baseUrl: https://ark.cn-beijing.volces.com/api/coding/v3
    model: deepseek-v4-pro
    maxTokens: 32768
    reasoningEffort: high

  deepseek:
    provider: deepseek
    apiKeyEnv: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    model: deepseek-v4-pro
    maxTokens: 32768
    reasoningEffort: max
    userId: cache-worker-1

  custom:
    provider: openai-compatible
    apiKeyEnv: CUSTOM_API_KEY
    baseUrl: https://gateway.example/v1
    model: custom-model
    maxTokens: 32768
```

Change `activeProfile` for the persistent default. For a single process, keep
the YAML unchanged and select a profile with:

```powershell
$env:OPENCAT_MODEL_PROFILE = "deepseek"
npm run web
```

The profile name is only a local label. `provider` controls compatibility:

| Provider | Use for |
| --- | --- |
| `deepseek` | DeepSeek APIs and their `user_id`, thinking, prefix, and reasoning extensions |
| `volcengine` (alias `ark`) | Volcengine Ark and Ark Coding Plan |
| `openai-compatible` | Other Chat Completions-compatible gateways |

Do not create both `openai` and `openai-compatible` profiles for the same
protocol. `openai-compatible` is the single generic adapter.

## Secrets

Prefer environment variable names in YAML:

```powershell
$env:ARK_API_KEY = "your-api-key"
$env:DEEPSEEK_API_KEY = "your-api-key"
$env:CUSTOM_API_KEY = "your-api-key"
```

For a private single-user setup where environment inheritance is inconvenient,
`apiKey` may contain the secret directly. Never commit that file.

## Fields

| Field | Meaning |
| --- | --- |
| `activeProfile` | Default entry selected from `profiles` |
| `provider` | `deepseek`, `volcengine`/`ark`, or `openai-compatible` |
| `apiKey` | Optional direct API key in the private user config |
| `apiKeyEnv` | Environment variable containing the API key |
| `baseUrl` | Provider API base URL, normally ending in `/v1`, `/v3`, or `/coding/v3` |
| `model` | Model name or endpoint ID |
| `maxTokens` | Positive integer output-token limit |
| `reasoningEffort` | `low`, `medium`, `high`, `xhigh`, or `max` |
| `userId` | DeepSeek request identity used for KV-cache isolation |
| `headers` | Optional static HTTP headers |

The legacy single `model:` mapping remains supported.

## Precedence

Configuration is resolved in this order:

1. `OPENCAT_MODEL_PROFILE` selects the YAML profile.
2. OpenCat environment overrides such as `OPENCAT_MODEL` replace profile fields.
3. Provider variables such as `ARK_MODEL`, `DEEPSEEK_MODEL`, or `OPENAI_MODEL`.
4. Values in the selected YAML profile.
5. Built-in defaults.

The API-key order is `OPENCAT_API_KEY`, provider-specific environment key,
profile `apiKey`, the variable named by `apiKeyEnv`, then `OPENAI_API_KEY`.

Supported environment overrides:

```text
OPENCAT_CONFIG_PATH
OPENCAT_MODEL_PROFILE
OPENCAT_MODEL_PROVIDER
OPENCAT_API_KEY
OPENCAT_API_BASE_URL
OPENCAT_MODEL
OPENCAT_MAX_TOKENS
OPENCAT_REASONING_EFFORT
```

## Cache usage normalization

DeepSeek reports `prompt_cache_hit_tokens` and
`prompt_cache_miss_tokens`. OpenAI-compatible providers such as Ark may report
`prompt_tokens_details.cached_tokens` instead. OpenCat normalizes both forms to
the DeepSeek-style internal fields before telemetry, transcript persistence,
and evaluation aggregation.
