// 上游 `WorkspaceController` 的**适配行**：`workspace` 组的远端面（以及它内部装的
// `directoryPicker` 组）由上游那一份提供服务。
//
// **为什么交回上游**：wire 载体换成上游 `/api/remote.mux` 之后，分派只认 `ctx.typert` 的
// remote 面（`TypertGatewayService` 扫服务实例上的 `typertRemote` 绑定与 `@Remote` 标记）——
// 自研 `RemoteHandlers` 路由表没有读者，`workspace/*` 于是没有人认领。
//
// **单参 `fromCordis`**：这一行没有第二个消费方按能力注入它（令牌从上游插件名派生
// `workspaceController`），所以不造契约——与 `ToolAskUser`（`@morlay/dsh-permission`）同一条口径。
//
// **目录选择不再单独装**：上游这一行的构造里 `ctx.plugin(DirectoryPickerController)` 会自己在
// 同一层装 `directoryPicker` 组（`static inject = ['directoryPicker']` 指向本仓的 backend 契约）。
// 我们那条 `DirectoryPickerControllerRow` 因此从装配里退出——两行装同一个上游类会撞同名服务。
import { WorkspaceController } from "@deepseek-ai/dsh-api-workspace-controller";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { RemoteAccess, Typert } from "@morlay/zephyr-app";
// 兄弟面的契约走包出口：`../contract/` 会让契约类在两个子出口产物里各内联一份。
import { WorkspaceRegistry } from "@morlay/dsh-workspace/contract";

/** 上游 `WorkspaceController` 的宿主行：`workspace` 组的全部端点。 */
@Injectable()
export class WorkspaceRemoteHost extends fromCordis(WorkspaceController) {
  /**
   * 准入：`follow` 逐帧按 `allows()` 过滤资源（本机部署那一档永远放行）。
   *
   * **可选**：只装数据面的装配（纯端点测试）没有 wire 面；上游 `static inject` 仍需要这个键存在，
   * 所以 deps 里照样给（`undefined`），只是本行不因为缺它而装不上。
   */
  private readonly depRemoteAccess = inject.optional(RemoteAccess);

  /** 类型化 Remote 注册表：上游构造里 `typert.resources.register('workspace', …)`。 */
  private readonly depTypert = inject(Typert);

  /** 工作区注册表：命令与 `follow` 的 baseline 都读它。 */
  private readonly depWorkspaces = inject(WorkspaceRegistry);

  override async onInit(ctx: Context): Promise<void> {
    // 上游 `static inject` 是三个**上游注册名**，这里逐条按名字交给 `mount` 的 deps
    // （`fromCordis` 的 deps 就是「上游按名字读」的通道，不向容器发布别名）。
    // config 不给：`documentsDirectory` 缺省、`documentsLookupTimeoutMs` 取 schema 默认（10s）。
    await this.mount(ctx, undefined, {
      remoteAccess: this.depRemoteAccess,
      typert: this.depTypert,
      workspaceRegistry: this.depWorkspaces,
    });
  }
}
