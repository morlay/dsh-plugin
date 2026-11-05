// `@RemoteClient()` 的转发必须真的走到**传输接缝**（真 wire 的帧形状由 `mux-seam.spec` 守）。
//
// 咬住的事故：转发最初读 `remote.upstream[<group>][<method>]`，而我们的 `Remote` 实现里
// `upstream` 恒为空对象——转发因此永远返回 `undefined`。消费方（权限 chip 的
// `live.command('/permission …')`）拿到的是"命令执行完了"，宿主侧一次都没被调到，
// 界面表现为"点了切换、什么都不变"，而且不报错。
//
// 判据就两条：宿主收到的是 `{ request }`（与 `registerRemoteGroup` 的 `requestOf` 对称），
// 以及契约方法的返回值原样透传。
import { bootstrapApplication, configure, inject } from "@morlay/zephyr";
import {
  Remote,
  RemoteClient,
  RemoteGroup,
  RemoteMethod,
  remoteDescriptorsOf,
} from "@morlay/zephyr-app/remote";
import {
  ClientConnectionDefault,
  mockTransport,
  provideClientConnection,
  provideClientRemote,
} from "@morlay/zephyr-app/client";
import { describe, expect, it } from "vitest";

/** 一份两端共用的组契约：一个带请求的方法、一个无参方法。 */
@RemoteGroup({ name: "demo" })
class DemoEndpoint {
  @RemoteMethod()
  async echo(_request: { text: string }): Promise<{ text: string }> {
    throw new Error("契约类未实现");
  }

  @RemoteMethod()
  async ping(): Promise<string> {
    throw new Error("契约类未实现");
  }
}

/** 浏览器侧的形态：不实现，靠 `@RemoteClient()` 生成转发。 */
@RemoteClient()
class DemoEndpointClient extends DemoEndpoint {
  protected readonly remote = inject(Remote);
}

describe("`@RemoteClient()` 的转发（假 transport）", { timeout: 15_000 }, () => {
  it("契约方法的调用真的到达传输层，返回值原样透传", async () => {
    // 宿主侧：与 `registerRemoteGroup` 同一条路（这里手写 handler，只为不引业务包）。
    const seen: unknown[] = [];
    const transport = mockTransport({
      "demo/echo": (payload) => {
        const request = (payload.args as { request: { text: string } }).request;
        seen.push(payload.args);
        return { text: `${request.text}!` };
      },
      "demo/ping": (payload) => {
        seen.push(payload.args);
        return "pong";
      },
    });

    const app = await bootstrapApplication({
      providers: [
        ...provideClientConnection(
          configure(ClientConnectionDefault, { origin: "http://127.0.0.1:1" }),
        ),
        ...provideClientRemote(),
        DemoEndpointClient,
      ],
      timeoutMs: 15_000,
    });
    try {
      const remote = app.get(Remote) as unknown as {
        useTransport(t: unknown): void;
        $mount(c: unknown): Promise<() => Promise<void>>;
        demo?: { echo(request: { text: string }): Promise<unknown>; ping(): Promise<unknown> };
      };
      remote.useTransport(transport);

      const client = app.get(DemoEndpointClient);
      expect(await client.echo({ text: "hi" }), "返回值要原样透传").toEqual({ text: "hi!" });
      expect(await client.ping(), "无参方法也要能到传输层").toBe("pong");

      // 参数形状与宿主侧 `requestOf(args)` 对称：带请求的是 `{ request }`，无参是空对象。
      expect(seen).toEqual([{ request: { text: "hi" } }, {}]);

      // 同一份声明也能编译成 `$mount` 的 descriptors，让 `remote.<group>` 这一面存在
      // （上游那些按 namespace 读的消费方——`ui-commands` 读 `remote.commands`——靠它）。
      await remote.$mount(remoteDescriptorsOf(DemoEndpoint));
      // 这一面包 `RemoteResult`：上游消费方就是按 `result.ok` / `result.value` 读的。
      expect(await remote.demo?.echo({ text: "again" }), "`remote.<group>` 面与契约同形").toEqual({
        ok: true,
        value: { text: "again!" },
      });
    } finally {
      await app.dispose();
    }
  });
});
