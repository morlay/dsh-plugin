/**
 * 转发事件（`remote.$on`）里 **waterfall** 频道的一帧应答。
 *
 * 与上游 `api/gateway/src/client/remote-events.ts` 的 `RemoteEventReplyOutcome` 同形：浏览器半的监听者
 * 用返回值回答宿主，宿主侧 `ctx.waterfall(…, next => …)` 据此继续。
 *
 * - `result`：已处理，瀑布到此停止，宿主拿到 `value`；
 * - `next`：放行，交给下一个监听者或宿主默认行为（**监听者返回 `undefined` 等价于这一态**）；
 * - `rejected`：处理失败（例如“用户点了拒绝”的正规路径），宿主收到结构化错误。
 */
export type RemoteEventReply =
  | { readonly kind: "result"; readonly value: unknown }
  | { readonly kind: "next" }
  | { readonly kind: "rejected"; readonly error: { readonly code: string; readonly message: string } };
