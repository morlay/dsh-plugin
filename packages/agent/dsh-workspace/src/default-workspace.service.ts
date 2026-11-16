// 启动时把**起始目录**登记成工作区（默认工作区）。
//
// 会话创建只认已注册的工作区（`SessionWorkspaceHost.resolve` 不再按 cwd 懒创建），所以启动这一刻
// 得有人把"从哪儿开始"登记进去——否则 `session/create {}` 找不到落点、侧栏也没有可选的工作区。
// 幂等：已经注册过就什么都不做（重启后沿用同一份）。
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { WorkspaceRegistry } from "./contract/workspace.contract.ts";

@Injectable()
export class DefaultWorkspace implements OnInit {
  private readonly registry = inject(WorkspaceRegistry);

  /**
   * 起始目录的来源：`AppEnv` 是**唯一**回答"我在哪个目录"的地方（打包形态的 cwd 不是它）。
   *
   * 必需注入：这一行存在的全部意义就是登记起始目录，没有 `AppEnv` 它无事可做——
   * 那种装配是错误，要在装配期就失败，而不是静默少一个工作区。
   */
  private readonly appEnv = inject(AppEnv);

  async onInit(_ctx: Context): Promise<void> {
    const pwd = this.appEnv.defaultWorkingDirectory;
    if ((await this.registry.resolveByPath(pwd)) !== undefined) return;
    await this.registry.create(pwd);
  }
}
