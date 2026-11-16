// 开发运行时的**启动面**：把「一棵已装配好的树」起成一个 dev 会话（CLI 只看会话，不看行树）。
//
// 为什么是 (b)「接收已装配的 App」而不是 (a)「内部自己 bootstrap 一棵只含 dev 行的树」：
//   - `zephyr dev` 只有**一棵**树——设计（20261113-开发构建与产物布局 §四）写的就是
//     「清单 = `devProviders(mode)` + 应用 `server.ts` 的清单」。dev 行由应用清单给、域行也在同一棵树里；
//     这里再装一棵「只含 dev 行」的树，就是设计明确否掉的「CLI 树 + 应用树」两棵。
//   - 换树（`DevHmr` → dispose → 带 `?v=` 重新 import 清单）归 CLI：那是「先拆后起、卡住就退出」的流程事实，
//     不该搬进框架包；若这里自己装配，换树就要在 CLI 与库两处各写一遍。
//   - 部署事实只有一个来源（设计 §九 `AppEnv`）：树里已经有 `profileDir` / `dataDir` / 缓存根，
//     这里再拼一套路径参数只会长出第二份。
//
// 于是本函数只做三件事：**核对交进来的事实与树里的一致**、**报出真实端口**、**收尾（幂等）**。
import { Logger, type App } from "@morlay/zephyr";
import { AppEnv, WebServer } from "@morlay/zephyr-app";
import { Federation } from "../federation/federation.contract.ts";
import { appBootDirOf } from "../internal/package-root.ts";

/** 起一次 dev 会话要的事实（全部由调用方给：它们是部署值，本包猜不出来）。 */
export interface DevOptions {
  /** 已装配的行树（含 dev 行：`devProviders()` 在应用清单里）。 */
  readonly app: App;
  /** 工作区（`zephyr.config.ts` 所在目录）：应与树里的 `AppEnv.values.profileDir` 是同一份。 */
  readonly repoRoot: string;
  /** vite 缓存：应与树里的 `AppEnv.cacheDirOf("vite")` 是同一份。 */
  readonly cacheDir: string;
  /** 应用的 `src/client`（页面骨架与入口所在目录）：应与 `appBootDirOf(profileDir)` 是同一份。 */
  readonly appRoot: string;
  /** 数据根（DSH_HOME）。 */
  readonly dataDir: string;
  /**
   * 当文件名单（`Federation.dev.include`）：命中的包逐文件走 vite，其余一律预编译。
   *
   * **缺省从树里取**（`Federation.config.dev.include`）：那是 `devProviders()` 那一行的配置，
   * 调用方再抄一遍就是同一事实两个 home；显式给了就核对（不一致同样是装配错误）。
   */
  readonly devFiles?: readonly string[];
  /** 期望的监听端口（`--port`）；缺省或 `0` 时以系统分配到的为准。 */
  readonly port?: number;
  /** 期望的监听地址（`--host`）。 */
  readonly host?: string;
}

/** 一次 dev 会话：**只够 CLI 用**（端口、地址、收尾），行树不外露。 */
export interface DevSession {
  /** 实际监听的端口（`0` 时由系统分配，调用方要拿到真的那个）。 */
  readonly port: number;
  /** 宿主 http 地址（`http://127.0.0.1:<port>/`）。 */
  readonly url: string;
  /** 关掉：撤路由、停 vite、释放端口。幂等。 */
  close(): Promise<void>;
}

/**
 * 起一个 dev 会话。
 * @param options - 已装配的行树与部署事实。
 * @returns 端口、地址与幂等的收尾。
 * @throws Error 树里的部署事实与交进来的不一致（装配错了根，服务会指向别处）。
 */
export async function startDev(options: DevOptions): Promise<DevSession> {
  const { app } = options;
  const appEnv = app.get(AppEnv);
  const webServer = app.get(WebServer);
  const devFiles = options.devFiles ?? app.get(Federation).config.dev.include;
  assertFacts(options, appEnv, devFiles);
  const port = webServer.port;
  const host = webServer.host;
  const url = `http://${host}:${String(port)}/`;
  report(app, options, url, devFiles);
  let closed: Promise<void> | undefined;
  return {
    port,
    url,
    // 幂等：重复 `close()` 只拆一次（`app.dispose()` 自己也保证逆序只跑一遍）。
    close: () => (closed ??= app.dispose()),
  };
}

/**
 * 核对「交进来的部署事实」与「树里那份」一致。
 *
 * 为什么值得核：`AppEnv` 是路径的唯一来源（设计 §九），而装配根、页面目录、vite 缓存**三个值**
 * 各自由规则从它派生。调用方（CLI）手里也有一份同名事实，两边不一致时的症状是
 * 「页面 200，但读写的是另一个工作区 / 缓存落在另一处」——那是排查里最贵的一类，
 * 不如在会话起来的那一刻就报出来，并列出全部不一致项。
 * @param options - 调用方给的事实。
 * @param appEnv - 树里的环境。
 * @param devFiles - 实际生效的当文件名单（缺省来自树里）。
 * @throws Error 有不一致项（逐条列出）。
 */
function assertFacts(options: DevOptions, appEnv: AppEnv, devFiles: readonly string[]): void {
  const inTree = {
    repoRoot: appEnv.values.profileDir,
    dataDir: appEnv.values.dataDir,
    appRoot: appBootDirOf(appEnv.values.profileDir),
    cacheDir: appEnv.cacheDirOf("vite"),
  };
  const mismatches = (Object.keys(inTree) as (keyof typeof inTree)[])
    .filter((key) => inTree[key] !== options[key])
    .map((key) => `${key}：树里 ${inTree[key]}，给的是 ${options[key]}`);
  // 名单只在调用方**显式给了**时核对：缺省就是从树里取的，不存在"对不上"。
  if (options.devFiles !== undefined && options.devFiles.join(",") !== devFiles.join(",")) {
    mismatches.push(
      `devFiles：树里 ${devFiles.join(", ") || "(空)"}，给的是 ${options.devFiles.join(", ") || "(空)"}`,
    );
  }
  if (mismatches.length === 0) return;
  throw new Error(
    `dev 会话的部署事实对不上（树是按另一份根装配的）：\n  ${mismatches.join("\n  ")}`,
  );
}

/**
 * 启动记录：一行说清「谁在哪个地址上服务哪个工作区」（debug 级——info 级的地址由 `WebRuntimeService` 打）。
 *
 * 期望值与实际值不一致时给一条 warn：`--port` / `--host` 是命令行的值，而监听值来自 `WebStartup`
 * （`process.env.PORT` / `HOST`）。两者不一致时页面在**另一个**端口上，这条是唯一能立刻定位的线索。
 * @param app - 行树（取 logger）。
 * @param options - 调用方给的事实。
 * @param url - 真实地址。
 * @param devFiles - 实际生效的当文件名单。
 */
function report(app: App, options: DevOptions, url: string, devFiles: readonly string[]): void {
  const logger = app.get(Logger);
  logger.debug(
    "[dev] 会话就绪 %s（工作区=%s 页面=%s 数据根=%s 缓存=%s 当文件名单=%s）",
    url,
    options.repoRoot,
    options.appRoot,
    options.dataDir,
    options.cacheDir,
    devFiles.length === 0 ? "(空 = 全部预编译)" : devFiles.join(", "),
  );
  const actual = new URL(url);
  const expected = [
    options.port === undefined || options.port === 0 || options.port === Number(actual.port)
      ? undefined
      : `port=${String(options.port)}`,
    options.host === undefined || options.host === actual.hostname
      ? undefined
      : `host=${options.host}`,
  ].filter((item): item is string => item !== undefined);
  if (expected.length === 0) return;
  logger.warn(
    "[dev] 命令行给的 %s 与监听值 %s 不一致：监听值来自 WebStartup（环境变量 PORT / HOST），不是命令行 flag。",
    expected.join(", "),
    url,
  );
}