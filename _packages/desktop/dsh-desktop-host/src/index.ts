// 桌面宿主进程的**入口**：解析参数 → 装配 profile → 接线。就这三步——协议在
// [`./desktop-ipc.ts`](./desktop-ipc.ts)、装配在 [`@morlay/dsh-app-boot`](../../boot/dsh-app-boot/README.md)、传输接管在
// [`./transport.ts`](./transport.ts)；`webServer` 服务来自上游 `@deepseek-ai/dsh-host-webserver`。
//
// argv 与 web 入口**同一套**（见 [`./invocation.ts`](./invocation.ts)）：
// `--profile-dir <dir> --runtime-dir <dir> [--patch <file>]... [--pnpm <path> --node-bin <dir>] [-- <内层参数>]`；
// 另加两条通道：请求/响应字节管道（FD 3/4）与 Node IPC（`ready` / `fatal` / `shutdown`）。
// 装配层完全由 profile 的 `dsh.profile.bundles` 决定：打包形态的 profile 由工具按官方形态种出
// （见 `../.agents/designs/20260929-桌面host的运行时面与依赖边界.md`）；dev 形态由启动器把 app 目录当
// profile root 传进来（同一份清单，见 `../../dshdev/.agents/designs/20261010-app目录即profile-root.md`）。

import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import { bootAppProfile } from "@morlay/dsh-app-boot";
import { connectDesktopIpc } from "./desktop-ipc.ts";
import { fatalEvent } from "./fatal.ts";
import { parseHostInvocation } from "./invocation.ts";
import { installPreloadSource } from "./preload-source.ts";
import {
  DESKTOP_STREAM_PATH,
  desktopStreamStats,
  installDesktopTransport,
  takeOverDesktopAuthentication,
} from "./transport.ts";
import { DESKTOP_HOST_PROTOCOL_VERSION, type DesktopHostEvent } from "./wire.ts";
import type {} from "@deepseek-ai/dsh-api-gateway";
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-host-webserver";

// 桌面形态自己的 overlay：产品遥测、账号 UI，以及 web-runtime 的桌面配置。
const DESKTOP_PATCH = fileURLToPath(new URL("../config/desktop.cordis.patch.yml", import.meta.url));

// 按需的内存/流上报：默认关，`DSH_MEMORY_REPORT=1` 时每 5 秒一行。用来把「宿主内存一直在涨」
// 落到具体哪条流、多少字节上（heapUsed 涨 = 转译/业务对象，external 涨 = 缓冲或原生件）。
function reportMemoryWhenAsked(ctx: Context): void {
  if (process.env.DSH_MEMORY_REPORT !== "1") return;
  const megabytes = (value: number): string => (value / 1024 / 1024).toFixed(1);
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    ctx.logger.info(
      `[dsh-desktop] memory rss=${megabytes(memory.rss)}MB heapUsed=${megabytes(memory.heapUsed)}MB ` +
        `external=${megabytes(memory.external)}MB | streams active=${String(desktopStreamStats.active)} ` +
        `opened=${String(desktopStreamStats.opened)} failed=${String(desktopStreamStats.failed)} ` +
        `items=${String(desktopStreamStats.items)} bytes=${megabytes(desktopStreamStats.bytes)}MB`,
    );
  }, 5000);
  timer.unref();
}

// 插件页的包操作通道：随包 node 跑随包 pnpm；`ELECTRON_RUN_AS_NODE` 让 Electron 把自己当 node 用。
function packageManagerOf(pnpmEntry: string, nodeBin: string | undefined) {
  return {
    command: process.execPath,
    args: ["--expose-internals", pnpmEntry],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
      PATH: `${nodeBin ?? ""}${nodeBin === undefined ? "" : ":"}${process.env.PATH ?? ""}`,
    },
  };
}

async function main(): Promise<void> {
  const invocation = parseHostInvocation("dsh desktop", process.argv.slice(2));
  if (process.send === undefined)
    throw new Error(
      "dsh desktop: expected a Node IPC channel and the byte pipes on fd 3/4 (the shell owns them)",
    );
  const { profileDir, patches, pnpmEntry, nodeBin, inner } = invocation;

  // 装配走 [`./app-boot.ts`](./app-boot.ts) 那条路（与 web 形态同一份实现）：层由 profile 的
  // `dsh.profile.bundles` 决定（各 bundle 自己的 patch 由 loader 按 `dsh.bundle.patch` 读），
  // 这里只按顺序补两层 overlay：调用方给的（壳）+ 桌面形态自己的。
  const application = bootAppProfile({
    profileDir,
    profile: "desktop",
    patchFiles: [...patches, DESKTOP_PATCH],
    // 桌面壳自己管窗口：不让 app 行去开浏览器；`--` 之后的内层参数排在其后。
    args: ["--no-open", ...inner],
    ...(pnpmEntry === undefined ? {} : { packageManager: packageManagerOf(pnpmEntry, nodeBin) }),
  });

  const { ctx } = await application;
  takeOverDesktopAuthentication(ctx);
  installDesktopTransport(ctx);
  reportMemoryWhenAsked(ctx);
  // 调试窗口的前端产物：桌面档自己托管，不从上游 inspector 行取（那条路由与它的 Worker 绑在一起）。
  // preload 的源码由这里现场打成 CJS（sandboxed preload 只能 CJS），壳在窗口创建前取走——装配目录里
  // 因此不再需要一份预产的 `dist/`。
  const shellRoot = process.env["DSH_DESKTOP_SHELL_ROOT"];
  if (shellRoot !== undefined && shellRoot !== "") {
    installPreloadSource(ctx, { shellRoot });
  }
  // 真 webServer（上游 `@deepseek-ai/dsh-host-webserver`）：只用它的 `port` 报 origin 给壳。
  const webServer = ctx.get("webServer") as unknown as { readonly port: number };
  const ipc = connectDesktopIpc({ application });

  const gateway = ctx.get("typertGateway");
  ctx.logger.info("transport ready %o", {
    // 结构化字段：键名 `.` 分层、不带空格；值作为参数传（不走 `key=value` 文本）。
    webServer: webServer.constructor.name,
    gateway: gateway === undefined ? "missing" : "present",
    streamRoute: DESKTOP_STREAM_PATH,
  });
  ipc.send({
    type: "ready",
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    // 真 webServer 的 origin：壳用它载入窗口。基于 URL/WS 的东西（settings 的 describe 流、账号的
    // stream mux、vite 的 HMR）都要求窗口的来源是它——以前没有 origin（请求走字节管道喂进来），那些
    // 长连接拿不到答复，表现为"设置页永远不可用、连请求都看不到"。
    origin: `http://127.0.0.1:${String(webServer.port)}`,
  });
}

if (import.meta.main) {
  // 顶层兜底**只能用 console**：走到这里时树可能还没起（`ctx.logger` 不存在）或已经拆了。
  main().catch((error: unknown) => {
    if (process.send !== undefined && process.connected)
      process.send(fatalEvent(error) satisfies DesktopHostEvent, (sendError) => {
        if (sendError !== null) console.error(sendError);
      });
    console.error(error);
    process.exitCode = 1;
    if (process.connected) process.disconnect?.();
  });
}
