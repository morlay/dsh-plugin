// 包出口：三条面都要按包名解析得到（`./ui` 由浏览器半落地后补一条）。
//
// 用**包名** import 就是把 `exports` 本身当接缝：出口写错、漏了一条、文件改名，这条立刻红。
import { describe, expect, it } from "vitest";
import * as root from "@morlay/better-session";
import * as endpoint from "@morlay/better-session/endpoint";
import * as server from "@morlay/better-session/server";

describe("包出口", () => {
  it("包根出契约 + 默认实现（装配函数在 ./server，root 不 import server/）", () => {
    // 契约面。
    expect(typeof root.SessionBranch).toBe("function");
    expect(typeof root.SessionEditor).toBe("function");
    expect(typeof root.SessionPersistence).toBe("function");
    // 能力探测是契约的一部分（消费方在边界处探一次）。
    expect(typeof root.asRdbStore).toBe("function");
    // 默认实现随包根导出（`abstract class Xxx` + `XxxDefault` 是标准搭配）。
    expect(typeof root.SessionPersistenceRdb).toBe("function");
    expect(typeof root.SessionQueryRdb).toBe("function");
    expect(typeof root.SessionEditorDefault).toBe("function");
    expect(typeof root.StorageTakeoverDefault).toBe("function");
    // **装配函数不在包根**：它有 server 面，装配面只从 `./server` 取。
    expect(root).not.toHaveProperty("provideBetterSession");
    // 事件也不在包根：`session/*` 是会话域的事件，权威定义在 `@morlay/dsh-session`。
    expect(root).not.toHaveProperty("Events");
  });

  it("./endpoint 出两组 remote 契约与两端共用的值", () => {
    expect(typeof endpoint.SessionEditorEndpoint).toBe("function");
    expect(typeof endpoint.SessionAdminEndpoint).toBe("function");
    // 配平算法是两端共用的纯函数。
    expect(typeof endpoint.balanceRewindPrefix).toBe("function");
    expect(typeof endpoint.rewindKeepLength).toBe("function");
    expect(endpoint.SESSION_BRANCH_VERSION_SCHEMA).toBe(1);
  });

  it("./server 出宿主面的装配函数与端点实现", () => {
    // **一个面一个装配函数**：行清单在包里写全，装配面只写这一句。
    expect(typeof server.provideBetterSession).toBe("function");
    expect(typeof server.SessionEditorEndpointDefault).toBe("function");
    expect(typeof server.SessionAdminEndpointDefault).toBe("function");
    // 清单本身可展开（装配面只写 `...provideXxx()`），且两组端点行都在里面。
    const names = server.provideBetterSession().map((entry) => {
      if (typeof entry === "function") return entry.name;
      const record = entry as { readonly provide?: { readonly name?: string } };
      return record.provide?.name ?? "";
    });
    expect(names).toContain("SessionEditorEndpointDefault");
    expect(names).toContain("SessionAdminEndpointDefault");
    expect(names).toContain("StorageTakeoverDefault");
  });

  it("会话事件由域包提供（一份权威定义，订阅方从这里取）", async () => {
    const domain = await import("@morlay/dsh-session");
    // 四个会话生命周期事件都在域包的 `Events` 命名空间下，参数表对齐上游 `SessionEventMap`。
    for (const name of [
      "SessionCreated",
      "SessionEventAppended",
      "SessionFlush",
      "SessionDisposed",
    ] as const) {
      expect(typeof domain.Events[name]).toBe("function");
    }
    // 订阅方用自己的实例订阅到的，与上游 `ctx.emit("session/flush", …)` 是同一个 cordis 事件。
    expect(new domain.Events.SessionFlush().name).toBe("session/flush");
    expect(new domain.Events.SessionCreated().name).toBe("session/created");
  });
});
