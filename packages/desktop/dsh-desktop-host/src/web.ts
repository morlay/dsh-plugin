// dev 形态的 web 启动入口（不进包的 `files`：只有 `dev --web` 用它）。
//
// 它做的事只有一件：把 **app 目录当 profile root** 启一次 web 形态——装配走 `app-boot`，与桌面
// 宿主同一份；`@deepseek-ai/dsh-web-app` 那套行（端口、认证、打印 URL、开浏览器）由 profile 的
// bundle 层提供，和上游 `dsh --profile web` 完全同一套。
//
// argv：`--profile-dir <dir> --runtime-dir <dir> [--patch <file>]... [-- <web app 的内层参数>...]`；
// 端口契约与上游一致：`PORT` 环境变量定缺省（3080），内层里显式 `--port` 以它为准，
// `--no-open` 等 flag 原样交给 web app 的 flag family。

import { bootAppProfile } from "./app-boot.ts";

/** 与上游 `dsh --profile web` 相同的缺省端口。 */
export const DEFAULT_WEB_PORT = "3080";

/** One parsed web dev invocation. */
export interface WebInvocation {
  /** profile root：app 目录本身。 */
  readonly profileDir: string;
  /** 安装根（官方闭包、前端产物与 host 载荷的来源）。 */
  readonly runtimeDir: string;
  /** 形态自己的 overlay patch 文件，按 argv 顺序。 */
  readonly patches: string[];
  /** `--` 之后的内层参数，原样交给 web app 的 flag family。 */
  readonly inner: string[];
}

/**
 * 解析本入口的参数。
 * @param argv - `process.argv.slice(2)`。
 * @returns profile root、安装根、overlay 与内层参数。
 * @throws 参数名不认识、或该带值的参数落在末尾时（缺值）。
 */
export function parseWebInvocation(argv: readonly string[]): WebInvocation {
  let profileDir: string | undefined;
  let runtimeDir: string | undefined;
  const patches: string[] = [];
  const inner: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "--") {
      inner.push(...argv.slice(index + 1));
      break;
    }
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`dsh web dev: ${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === "--profile-dir") profileDir = value();
    else if (argument === "--runtime-dir") runtimeDir = value();
    else if (argument === "--patch") patches.push(value());
    else throw new Error(`dsh web dev: unknown argument ${JSON.stringify(argument)}`);
  }
  if (profileDir === undefined || runtimeDir === undefined) {
    throw new Error(
      "dsh web dev: expected --profile-dir <dir> and --runtime-dir <dir> " +
        "(the same two anchors the desktop host takes)",
    );
  }
  return { profileDir, runtimeDir, patches, inner };
}

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
  const invocation = parseWebInvocation(process.argv.slice(2));
  const port = process.env.PORT ?? DEFAULT_WEB_PORT;
  console.error(
    `[dsh-web] profile root=${invocation.profileDir} runtime=${invocation.runtimeDir} port=${port}`,
  );
  await bootAppProfile({
    profileDir: invocation.profileDir,
    runtimeDir: invocation.runtimeDir,
    profile: "web",
    patchFiles: invocation.patches,
    args: webArgs(invocation.inner, port),
  });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
