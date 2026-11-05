// 会话统计投影（上游 `session-stats`）：整条日志的轮数 / 步数，以及 LLM、工具、首字、解码的墙钟时长。
//
// 客户端的 `ui-chat` 用它渲染输入区下方那两枚统计 pills（`activity` / `usage`）；
// 没有这个投影单元时它会退回「窗口内节点」的估算，翻页与压缩之后就只统计到一段。
import * as SessionStatsPlugin from "@deepseek-ai/dsh-session-stats";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjectionStore } from "../contract/session-projection-store.contract.ts";

@Injectable()
export class SessionStatsDefault extends fromCordis(SessionStatsPlugin) {
  private readonly projections = inject(SessionProjectionStore);

  override async onInit(ctx: Context): Promise<void> {
    // 上游按 `ctx.sessionProjections` 读；`register` 走的是同一个注册表，这里直接给契约面。
    await this.mount(ctx, undefined, { sessionProjections: this.projections });
  }
}
