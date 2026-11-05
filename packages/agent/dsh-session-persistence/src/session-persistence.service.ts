// 会话落盘行：**上游 `session-persistence-jsonl` 的适配**（本仓不写自己的实现）。
//
// 上游 `apply` 里是 `ctx.plugin({ apply: (serviceCtx) => new JsonlSessionPersistence(serviceCtx) })`，
// 服务注册在**子 fiber** 上；而 `session-query-sqlite` 那边是 `ctx.inject(['sessionPersistence'], …)`——
// cordis 的严格 inject 只认**祖先 fiber** 上的服务。所以 `mount` 必须挂在**根 ctx** 上：
// 用行 ctx 挂，查询侧读不到持久化绑定，重启后 `observeSession` 直接 `session/not-found`。
import * as JsonlPlugin from "@deepseek-ai/dsh-session-persistence-jsonl";
import { join } from "node:path";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { SessionPersistence } from "./contract/session-persistence.contract.ts";

@Injectable()
export class SessionPersistenceDefault extends fromCordis(SessionPersistence, JsonlPlugin) {
  private readonly appEnv: { readonly values: AppEnvValues } = inject(AppEnv);

  override async onInit(ctx: Context): Promise<void> {
    const root = (ctx as unknown as { root?: Context }).root ?? ctx;
    // 上游 `Config.root` 必填：它不拿 `process.cwd()` 兜底（cwd 会随子进程变动，一份后端被劈成两个根）。
    await this.mount(root, { root: join(this.appEnv.values.dataDir, "sessions") });
  }
}
