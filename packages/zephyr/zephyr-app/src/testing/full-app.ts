// 整装测试的支撑：给定**调用方给的清单**与一个 tmpdir 数据根，起一棵完整行树。
//
// 为什么在 zephyr-app 而不在 apps：各域包也要用「整份清单装得起来」的判据测自己的端点与会话面，
// 但它们不能反向依赖 apps（依赖方向是 包 → 框架，apps 在最上面）。清单仍由调用方给——
// 这个 helper 只负责"起得来、拿得到端口、拆得干净"，不替任何一层决定装什么。
import { bootstrapApplication, type App, type ProviderEntry } from "@morlay/zephyr";
import { WebServer } from "../web/web-server.contract.ts";

/** `mountFullApp` 的输入。 */
export interface MountFullAppOptions {
  /** 行清单：由调用方给（apps 用装配面的清单，包内用自己那份测试夹具清单）。 */
  readonly providers: readonly ProviderEntry[];
  /** 数据根。**必须是 tmpdir**：缺省值会落到开发者的真实数据目录。 */
  readonly dataDir: string;
  /** 装配超时（毫秒），缺省 60s。 */
  readonly timeoutMs?: number;
  /** 监听端口；缺省 0（随机），并行 spec 才不会互相抢。 */
  readonly port?: number;
}

/** 一棵起好的整装行树。 */
export interface FullApp {
  readonly app: App;
  /** 页面与 wire 的基址（`http://127.0.0.1:<port>`）。 */
  readonly origin: string;
  readonly port: number;
  /** 幂等：重复调用只拆一次。 */
  dispose(): Promise<void>;
}

/**
 * 起一棵完整行树。
 * @param options - 清单、数据根与可选超时/端口。
 * @returns 行树、访问基址与幂等 dispose。
 */
export async function mountFullApp(options: MountFullAppOptions): Promise<FullApp> {
  // `WebStartupDefault` 读 `process.env.PORT`（缺省 3080）：不设就会被并行 spec 抢同一个端口。
  process.env.PORT = String(options.port ?? 0);
  const app = await bootstrapApplication({
    providers: options.providers,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  const server = app.get(WebServer) as { port?: number };
  const port = server.port ?? 0;
  let disposed: Promise<void> | undefined;
  return {
    app,
    port,
    origin: `http://127.0.0.1:${String(port)}`,
    dispose: () => (disposed ??= app.dispose()),
  };
}
