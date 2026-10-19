// dev 形态的 web 启动入口（不进包的 `files`：只有 `dev --web` 用它）。
//
// 它做的事只有一件：把 **profile root 当 profile 启一次 web 形态**——装配走 `@morlay/dsh-app-boot`，与桌面
// 宿主同一份；`@deepseek-ai/dsh-web-app` 那套行（端口、认证、打印 URL、开浏览器）由 profile 的
// bundle 层提供，和上游 `dsh --profile web` 完全同一套。
//
// argv 与桌面宿主**同一套**（见 `./invocation.ts`）：`--profile-dir <dir> --runtime-dir <dir>
// [--patch <file>]... [-- <web app 的内层参数>...]`；端口契约与上游一致：`PORT` 环境变量定缺省
// （3080），内层里显式 `--port` 以它为准，`--no-open` 等 flag 原样交给 web app 的 flag family。

import { bootAppProfile } from "@morlay/dsh-app-boot";
import { parseHostInvocation } from "./invocation.ts";

/**
 * 缺省端口：`0` = 向系统要一个。
 *
 * 不跟着上游用 3080 写死——本机上跑第二个实例、或别的工具占了它，web 形态就只能靠"改 `PORT`"才起得来。
 * 实际端口看 web app 自己打的那行 `➜  Local:   http://127.0.0.1:<port>/`（浏览器也由它打开）。
 */
export const DEFAULT_WEB_PORT = "0";

/**
 * 把缺省端口补进内层参数：web app 的 flag family 自己解析 `--port`，所以这里只在内层没给
 * `--port` 时补一个。
 * @param inner - `--` 之后的内层参数。
 * @param port - `PORT` 环境变量给出的端口。
 * @returns 交给树的内层参数。
 */
export function webArgs(inner: readonly string[], port: string): readonly string[] {
  return inner.includes("--port") ? [...inner] : ["--port", port, ...inner];
}

async function main(): Promise<void> {
  const invocation = parseHostInvocation("dsh web", process.argv.slice(2));
  const port = process.env.PORT ?? DEFAULT_WEB_PORT;
  const { ctx } = await bootAppProfile({
    profileDir: invocation.profileDir,
    profile: "web",
    patchFiles: invocation.patches,
    args: webArgs(invocation.inner, port),
  });
  // 这行在**树起来之后**打：名字交给这条树的 logger（不自己拼 `[dsh-web]` 前缀），exporter 拿到的是字段。
  ctx.logger.info(
    "profile root=%s runtime=%s port=%s",
    invocation.profileDir,
    invocation.runtimeDir,
    port,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // 树没起来（或已经在拆）时只能用 console：这里没有 `ctx.logger` 可用。
    console.error(error);
    process.exitCode = 1;
  });
}
