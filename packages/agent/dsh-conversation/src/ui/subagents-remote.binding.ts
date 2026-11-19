// `subagents` namespace 的客户端绑定：会话界面里的子代理面（`remote.subagents`）从这里来。
//
// 与 `SessionRemoteBinding`（`session`）同一职责：浏览器里没有全局的 remotes 装载，每个 namespace
// 各自 `$mount` 自己那份 descriptor。少了这一行，`LiveSessionRemotes` 读 `remote.subagents` 会报
// `remote.subagents is not mounted yet`——而会话界面里所有子代理相关的入口（分支、发消息）都走它。
import SUBAGENTS_REMOTE from "@deepseek-ai/dsh-subagent/remote";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";

@Injectable()
export class SubagentsRemoteBinding implements OnInit {
  private readonly remote = inject(Remote);

  async onInit(): Promise<void> {
    // `$mount` 返回 disposer；本行没有卸载场景，忽略即可。失败要显式报出来，
    // 不要像上游那样静默（症状是「点了没反应」）。
    try {
      await this.remote.$mount(SUBAGENTS_REMOTE);
    } catch (error) {
      throw new Error(`挂载 subagents 远端失败：${(error as Error).message}`, { cause: error });
    }
  }
}
