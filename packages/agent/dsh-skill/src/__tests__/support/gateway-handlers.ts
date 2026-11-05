// 测试用：把 `typertGateway` 包成 `RemoteHandlers` 的形状。
//
// 为什么需要：`session/*` 现在由**上游** `SessionController` 提供、经 `typertGateway` 分派，
// 而我们的 handler 表只剩自研端点（`workspace/*` 等）。spec 里凡是 `handlers.invoke("session/…")`
// 的地方都要走 gateway；与其每处各写一遍，不如共用这一份。
import { RemoteHandlers, TypertGateway } from "@morlay/zephyr-app";
import type { App } from "@morlay/zephyr";

/**
 * 包一层：先查本应用的 handler 表（自研端点），"没有实现"时交给 `typertGateway`（上游 `@Remote` 服务）。
 *
 * 上游方法用**抛 `RemoteError`** 表达业务失败，这里折成 wire 的错误包装，既有的
 * `errorCodeOf(...)` 断言因此继续有效。
 * @param app - 应用。
 * @returns 同形状的调用面。
 */
export function gatewayHandlers(app: App): RemoteHandlers {
  const local = app.get(RemoteHandlers);
  const gateway = app.get(TypertGateway);
  const peer = {
    id: "spec",
    signal: new AbortController().signal,
    interactions: "answer",
    // 上游分派前读 `peer.principal.kind`（资源准入用）。
    principal: { kind: "browser", id: "spec" },
  };
  return {
    invoke: async (endpoint: string, args: Readonly<Record<string, unknown>>) => {
      // 先查自研 handler 表（`workspace/*` 这类还在我们这边），"没有实现"才交给 gateway。
      try {
        return await local.invoke(endpoint, args);
      } catch (error) {
        if (!/没有实现/.test(String(error))) throw error;
      }
      const at = endpoint.indexOf("/");
      try {
        return await gateway.invoke({
          namespace: endpoint.slice(0, at),
          method: endpoint.slice(at + 1),
          args,
          peer,
        } as never);
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown };
        return {
          ok: false,
          error: {
            code: typeof candidate?.code === "string" ? candidate.code : "gateway/internal",
            message: typeof candidate?.message === "string" ? candidate.message : String(error),
          },
        };
      }
    },
    stream: (endpoint, args, signal) => local.stream(endpoint, args, signal),
    register: local.register.bind(local),
    registerStream: local.registerStream.bind(local),
    subscribe: local.subscribe.bind(local),
    publish: local.publish.bind(local),
  } as RemoteHandlers;
}
