// wire 结果的解包（spec 之间共用一份，别各抄一遍）。
//
// 上游业务方法的 result schema 都是裸对象，`RemoteResult` 是 **gateway 层统一包的**；我们的端点行
// （`asRemoteResult`）与客户端（生成面）必须成对：那边包、这边解。spec 也要按同一口径读。
export type WireResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code?: string; readonly message?: string } };

/**
 * 从 wire 取业务值。**两种口径都要认**：
 *
 * - 自研端点（`asRemoteResult`）包成 `{ ok: true, value }`；
 * - 上游 `typertGateway` 分派的 `@Remote` 方法返回**裸值**（`{ accepted: true }`、`{ items }`…）。
 *
 * 只认包装的话，上游那一半的断言会一律读到 `undefined`——实测过：`session/prompt` 明明返回了
 * `{ accepted: true }`，spec 却报 `expected undefined`。
 * @param result - `handlers.invoke(...)` / `gateway.invoke(...)` 的返回值。
 * @returns 业务值；`ok: false` 或形状不对回 `undefined`。
 */
export function unwrap<T>(result: unknown): T | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  // 裸值：上游分派的 `@Remote` 方法。
  if (!("ok" in result)) return result as T;
  if (result.ok !== true) return undefined;
  return "value" in result ? (result.value as T) : undefined;
}

/**
 * 取 wire 的失败码。
 * @param result - `handlers.invoke(...)` 的返回值。
 * @returns `ok: false` 时 `error.code`；否则 `undefined`。
 */
export function errorCodeOf(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  if (!("ok" in result) || result.ok !== false) return undefined;
  if (!("error" in result) || typeof result.error !== "object" || result.error === null)
    return undefined;
  if (!("code" in result.error) || typeof result.error.code !== "string") return undefined;
  return result.error.code;
}
