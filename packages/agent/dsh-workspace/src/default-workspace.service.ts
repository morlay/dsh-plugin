// 启动时把**当前目录**登记成工作区（默认工作区）。
//
// 会话创建只认已注册的工作区（`SessionWorkspaceHost.resolve` 不再按 cwd 懒创建），所以启动这一刻
// 得有人把"我跑在哪儿"登记进去——否则 `session/create {}` 找不到落点、侧栏也没有可选的工作区。
// 幂等：已经注册过就什么都不做（重启后沿用同一份）。
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { WorkspaceRegistry } from "./contract/workspace.contract.ts";

@Injectable()
export class DefaultWorkspace implements OnInit {
  private readonly registry = inject(WorkspaceRegistry);

  async onInit(_ctx: Context): Promise<void> {
    const pwd = process.cwd();
    if ((await this.registry.resolveByPath(pwd)) !== undefined) return;
    await this.registry.create(pwd);
  }
}
