// `typertGateway` 这条**服务面**的接线：上游 `api/gateway` 的 `TypertGatewayService` 就是它的实现，
// 我们只负责装上它、并按服务名把契约接上。
//
// 为什么值得单独钉：上游所有 `@Remote` 服务（`ApiSessionController`、workspace / settings / permission
// 控制器…）执行时都找 `ctx.typertGateway`。这条服务没接上，它们「装得上、调不动」——
// 报错点会漂到很远的业务层。这里断言它存在、面齐、且能应答最基本的两个成员。
import { bootstrapApplication } from "@morlay/zephyr";
import { TypertGateway } from "../gateway.contract.ts";
import { provideTypert } from "../provide.ts";
import { Typert } from "../typert.contract.ts";
import { provideApiGateway } from "../../api-gateway/provide.ts";

import { RemoteAccess } from "../../remote-access/remote-access.contract.ts";
import { afterEach, describe, expect, it } from "vitest";

const opened: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
});

describe("typertGateway 的服务面", () => {
  it("装上 api-gateway 之后，`typertGateway` 按名字可解析且面齐", { timeout: 10_000 }, async () => {
    const app = await bootstrapApplication({
      providers: [
        ...provideTypert(),
        // 上游 `api/gateway` 的 inject 里有 `remoteAccess`（分派前做资源准入）；本 spec 不触发准入。
        {
          provide: RemoteAccess,
          useFactory: () =>
            ({
              allows: () => true,
              source: () => undefined,
              whenAccess: () => () => {},
              whenResourceAccess: () => () => {},
              registerPolicy: () => () => {},
              snapshotFor: () => ({}),
              follow: () => () => {},
              invalidate: () => {},
              typertRemote: {},
            }) as unknown as RemoteAccess,
        },
        ...provideApiGateway(),
      ],
      timeoutMs: 8_000,
    });
    opened.push(app);

    const gateway = app.get(TypertGateway);
    expect(gateway, "`typertGateway` 必须可解析").toBeDefined();
    expect(gateway.wireStream, "载体适配必须在").toBeDefined();
    expect(typeof gateway.invoke).toBe("function");
    expect(typeof gateway.stream).toBe("function");
    expect(typeof gateway.hasLiveClient).toBe("function");
    expect(gateway.getPendingRemoteEvents(), "初始没有未结算的转发事件").toEqual([]);
    // 契约只有一个：`TypertGateway`（`ApiGateway` 那个自造契约没有消费者，已删）。
    expect(gateway).toBeDefined();
    // 注册表同在：上游 `@Remote` 服务把自己登记进它。
    expect(app.get(Typert)).toBeDefined();
  });
});
