// agent 注册表：上游 `AgentRegistry`（cordis 服务）经 `fromCordis` 接管。
//
// 契约用 `SessionId` 品牌，与上游一致——品牌转换在边界（`endpoint/` 收 wire 字符串时）做一次。
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AgentDirectory } from "../contract/agent-directory.contract.ts";

@Injectable()
export class AgentDirectoryDefault extends fromCordis(AgentDirectory, AgentRegistry) {
  /** 上游 `static inject = ["sessionProjections"]`：初始化时用它登记 `turnBoundary` 投影。 */
  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessionProjections: this.sessionProjections });
  }
}
