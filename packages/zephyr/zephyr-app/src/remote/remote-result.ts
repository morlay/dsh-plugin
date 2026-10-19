// unary Remote 的**结果封装**：上游 wire 上每个 unary 方法的载荷是 `RemoteResult<T>`，
// 由 Typert 的 host dispatcher 包（业务值进 `value`，`RemoteError` 进 `error`）。
//
// 我们的 wire 由 `MuxServer` 独占，所以这份封装要在注册处自己做——
// 客户端的生成面（`ui-workspace` 的 `ClientWorkspaceModel`、`uiWorkspace.pickDirectory`）都按
// `result.ok` 解，返回裸值会让它们读到 `undefined`（典型症状：取消一次目录选择后
// `Cannot read properties of null (reading 'ok')`）。
/** 上游 wire 上的失败面（与 `RemoteFailure` 同形）。 */
export interface RemoteFailureWire {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

/** 上游 wire 上的结果面。 */
export type RemoteResultWire<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailureWire };

/**
 * 把任意异常折成 wire 的失败面。
 *
 * 上游 `RemoteError` 带 `code` / `details`，这里按**结构化**读它们（不引上游包：这份封装只认形状），
 * 读不到就归到 `gateway/invoke-failed`。
 */
export function failureOf(error: unknown): RemoteFailureWire {
  const message = error instanceof Error ? error.message : String(error);
  const shaped = typeof error === "object" && error !== null ? error : undefined;
  const code = shaped !== undefined && "code" in shaped ? shaped.code : undefined;
  const details = shaped !== undefined && "details" in shaped ? shaped.details : undefined;
  return {
    code: typeof code === "string" ? code : "gateway/invoke-failed",
    message,
    details: details ?? {},
  };
}

/**
 * 执行一次 unary 并包成 `RemoteResult`。
 * @param run - 业务调用。
 * @returns `{ ok: true, value }` 或 `{ ok: false, error }`。
 */
export async function asRemoteResult<T>(run: () => Promise<T>): Promise<RemoteResultWire<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: failureOf(error) };
  }
}
