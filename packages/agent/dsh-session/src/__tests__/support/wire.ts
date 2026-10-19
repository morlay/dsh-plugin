// wire 结果的解包（spec 之间共用一份，别各抄一遍）。
//
// 上游业务方法的 result schema 都是裸对象，`RemoteResult` 是 **gateway 层统一包的**；我们的端点行
// （`asRemoteResult`）与客户端（生成面）必须成对：那边包、这边解。spec 也要按同一口径读。
export type WireResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code?: string; readonly message?: string } };

/**
 * 从 wire 的 `RemoteResult` 取业务值。
 * @param result - `handlers.invoke(...)` 的返回值。
 * @returns `ok: true` 时的 `value`；失败或形状不对回 `undefined`。
 */
export function unwrap<T>(result: unknown): T | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  if (!("ok" in result) || result.ok !== true) return undefined;
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
  if (!("error" in result) || typeof result.error !== "object" || result.error === null) return undefined;
  if (!("code" in result.error) || typeof result.error.code !== "string") return undefined;
  return result.error.code;
}
