// `registerRemoteGroup` 的**多命名参数分派**：`upload(agent, request)` 这种 descriptor 是位置语义的方法。
//
// 判据来自真端点：`fileUploads/upload` 的 wire 是 `{ agent, request }`，而 `requestOf` 只把
// `args.request` 交出去——不按契约声明的 `parameters` 逐个取，宿主的方法永远收不到 `agent`
// （症状是每个上传都报「会话 "undefined" 没有 agent」）。
import { bootstrapApplication, inject, Injectable } from "@morlay/zephyr";
import { RemoteHandlers } from "../../api-gateway/remote-handlers.contract.ts";
import { RemoteHandlersDefault } from "../../api-gateway/remote-handlers.service.ts";
import { Remote, RemoteGroup } from "../decorators.ts";
import { registerRemoteGroup } from "../register.ts";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

/** 一个两个命名参数的端点（与 `fileUploads/upload` 同形）与一个单参数的对照片。 */
@RemoteGroup({ name: "demo" })
class DemoEndpoint {
  /** 两个命名参数：`(agent, request)`。 */
  @Remote({ parameters: ["agent", "request"] })
  async upload(agent: string, request: { readonly data?: string }): Promise<unknown> {
    return { agent, data: request.data };
  }

  /** 单命名参数（省略 `parameters`）：拿到的是整个 args。 */
  @Remote()
  async stat(request: { readonly path?: string }): Promise<unknown> {
    return { path: request.path };
  }
}

/** 宿主实现（`registerRemoteGroup` 在 `onInit` 里注册）。 */
@Injectable()
class DemoEndpointDefault extends DemoEndpoint {
  private readonly handlers = inject(RemoteHandlers);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }
}

/** 起一个只有 handler 表的装配。 */
async function boot(): Promise<RemoteHandlers> {
  const app = await bootstrapApplication({
    providers: [RemoteHandlersDefault, DemoEndpointDefault],
    timeoutMs: 5_000,
  });
  onTestFinished(() => app.dispose().catch(() => {}));
  return app.get(RemoteHandlers);
}

describe("registerRemoteGroup 的命名参数分派", () => {
  test("多个命名参数：按 `parameters` 的声明顺序逐个传参", async () => {
    const handlers = await boot();
    await expect(
      handlers.invoke("demo/upload", { agent: "s1", request: { data: "AA==" } }),
    ).resolves.toEqual({ agent: "s1", data: "AA==" });
  });

  test("单参数：仍然拿到整个 args（`requestOf` 的剥层语义不变）", async () => {
    const handlers = await boot();
    await expect(handlers.invoke("demo/stat", { path: "/tmp/a" })).resolves.toEqual({
      path: "/tmp/a",
    });
    await expect(handlers.invoke("demo/stat", { request: { path: "/tmp/b" } })).resolves.toEqual({
      path: "/tmp/b",
    });
  });
});
