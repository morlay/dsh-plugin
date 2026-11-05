/**
 * 装配冒烟：**整份 provider 清单装得起来**。
 *
 * 这是唯一能覆盖 `apps/` 装配层的测试——`packages/` 的测试各自装自己那几行，
 * 装不出"三十行一起上"才会出现的问题（缺服务、准入没配、行之间的依赖顺序）。
 *
 * 判据只有一条：`bootstrapApplication` 不抛 `providers failed to activate`。
 * 它不启动 HTTP、不发请求，只验证 DI 拓扑。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { clientPackagesOf, TypertGateway } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { customProvidersOf } from "../zephyr.provide.ts";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 60_000);

/**
 * 按入口 `main.ts` 的方式推导行清单。
 * @returns client 行包清单（`clientPackagesOf` 是异步的）。
 */
async function rowsOf(): Promise<readonly string[]> {
  return [...new Set(await clientPackagesOf(customProvidersOf([])))];
}

describe("整份装配", { timeout: 120_000 }, () => {
  it("三十行一起装：没有 `providers failed to activate`", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-custom-assembly-"));
    roots.push(root);
    // 装配面会真的 `listen`（`WebServerDefault` 读 `process.env.PORT`，缺省 3080）。
    // 测试必须用**随机端口**：占着 3080 会和其它并行跑的 web spec 撞（`EADDRINUSE`）。
    process.env.PORT = "0";
    const app = await bootstrapApplication({
      providers: customProvidersOf(await rowsOf()),
      timeoutMs: 60_000,
    });
    opened.push(app);
    expect(app, "装配成功才谈得上主流程").toBeDefined();

    // **装配成功 ≠ 能用**：真实链路上第一件事就是浏览器连上来调 `session/list`。
    // 准入默认 deny，没配放行策略时这一步会抛 `remote access: … access denied (no-allow)`，
    // 而那正是用户看到的那个报错——只在调用时出现，装配期看不出来。
    const gateway = app.get(TypertGateway) as {
      invoke(request: unknown): Promise<unknown>;
    };
    const listed = await gateway.invoke({
      namespace: "session",
      method: "list",
      args: {},
      peer: {
        id: "assembly-spec",
        signal: new AbortController().signal,
        interactions: "answer",
        // 与 `MuxServer` 同口径：本机宿主是 owner，准入走 baseline 放行。
        principal: { kind: "owner" },
      },
    });
    expect(listed, "`session/list` 必须能被分派（准入放行 + 服务就位）").toBeDefined();
  });
});
