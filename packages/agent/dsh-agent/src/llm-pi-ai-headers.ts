// `llm-pi-ai` 的 provider 头里可以写**环境引用**：`Authorization: "Bearer ${OLLAMA_API_KEY}"`。
//
// 为什么需要这一层：pi-ai 的 Anthropic 实现把 `apiKey` 发成 `x-api-key`（Anthropic 官方语义），
// 而走 `api: "anthropic-messages"` 的第三方网关（Ollama Cloud 这类）认的是 `Authorization: Bearer`。
// 那个头不能手写进 `configure(…, { providers })`：装配层会作为 `settings/describe` 的 `base` 下发到浏览器。
// 所以配置里只放**引用**，真值在 mount 前从启动环境快照解析，只存在于内存里的运行期 config。
//
// 读的是启动环境（`LaunchEnvironment` 的冻结快照：进程环境 → 项目 `.env` → `$DSH_HOME/.env`），
// 不碰凭证服务：这几条 provider 的 key 就是部署给的环境变量。
import type { LaunchEnvironmentLookup } from "./contract/launch-environment.contract.ts";

/** 一个 header 值里的环境引用：`${NAME}`。 */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu;

/** 一个普通 JSON 对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析一个 header 值里的环境引用。
 * @param value - 配置里写的 header 值。
 * @param lookup - 启动环境快照；没有该行时按「取不到」处理。
 * @returns 解析后的值；任一引用取不到时 `undefined`（这个头不发，而不是发一个字面量）。
 */
function resolveValue(
  value: string,
  lookup: LaunchEnvironmentLookup | undefined,
): string | undefined {
  let missing = false;
  const resolved = value.replace(REFERENCE, (_match, name: string) => {
    const hit = lookup?.get(name)?.value;
    // 空值等同于没有：`Authorization: "Bearer "` 只会把 401 变成更难查的 401。
    if (hit === undefined || hit.length === 0) {
      missing = true;
      return "";
    }
    return hit;
  });
  return missing ? undefined : resolved;
}

/** 解析一份 provider 头；取不到引用的头直接摘掉。 */
function resolveHeaders(
  headers: unknown,
  lookup: LaunchEnvironmentLookup | undefined,
): Record<string, string> | undefined {
  if (!isRecord(headers)) return headers as undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      out[name] = value as string;
      continue;
    }
    const resolved = resolveValue(value, lookup);
    if (resolved !== undefined) out[name] = resolved;
  }
  return out;
}

/**
 * 把一份 pi-ai 配置里 `providers[*].headers` 的环境引用解析成真值。
 *
 * 只动 `headers`：别的字段（`baseURL` / `models` …）里的 `${…}` 不是引用，原样保留。
 * 输入不被修改（`structuredClone` 后再改），因为同一份 config 会被 `settings/describe` 的 `base` 读。
 * @param config - 这一行收到的 config（装配 patch ⊕ 持久化值）。
 * @param lookup - 启动环境快照；`undefined` 时所有引用都按取不到处理。
 * @returns 解析后的 config；形状不认识时原样返回。
 */
export function resolveHeaderReferences(
  config: unknown,
  lookup: LaunchEnvironmentLookup | undefined,
): unknown {
  if (!isRecord(config)) return config;
  const providers = config["providers"];
  if (!isRecord(providers)) return config;
  const next = structuredClone(config);
  const nextProviders = next["providers"] as Record<string, unknown>;
  for (const [route, profile] of Object.entries(nextProviders)) {
    if (!isRecord(profile)) continue;
    if (!("headers" in profile)) continue;
    const headers = resolveHeaders(profile["headers"], lookup);
    if (headers === undefined || Object.keys(headers).length === 0) delete profile["headers"];
    else profile["headers"] = headers;
    nextProviders[route] = profile;
  }
  return next;
}
