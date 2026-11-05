// 应用侧的 client 装配（**只有装配**）：框架链 + 业务链 + 各域的前端行。
//
// 上游 UI 行按**它服务的领域**放在各自包里（会话界面在 `dsh-session`、设置面板在 `dsh-setting`、
// 命令弹层在 `dsh-command/ui`…），这里只决定**装哪些、按什么顺序装**。
import { without, type ProviderEntry, type ProviderFeature } from "@morlay/zephyr";
import {
  ClientConnectionDefault,
  provideClientChain,
  provideClientConnection,
  provideClientRemote,
  provideLayout,
  provideTheme,
  ProjectionsDefault,
  RemoteDefault,
  SessionRemoteBinding,
  SessionRemoteDefault,
} from "@morlay/zephyr-app/client";
import {
  provideModelSelectionSlots,
  provideSettingHost,
  provideSettingSlots,
} from "@morlay/dsh-setting/ui";
import { providePermissionUi, provideApproval, provideUserQuestionsSlots } from "@morlay/dsh-permission/ui";
import { provideCommandUi } from "@morlay/dsh-command/ui";
import { provideGoalUi } from "@morlay/dsh-goal/ui";
import { provideSkillUi } from "@morlay/dsh-skill/ui";
import {
  provideSessionInputSlots,
  provideSessionShell,
  provideSessionShellSlots,
  provideSessionSlots,
  provideSessions,
} from "@morlay/dsh-session/ui";
import { provideWorkspaceSlots, provideWorkspaceUi } from "@morlay/dsh-workspace/ui";

/**
 * 应用侧 client 清单：框架链 + 业务链 + 各域前端行。
 *
 * 顺序 = 依赖（提供方在前）；三处跨包硬约束用注释钉住，别"看起来能跑"就重排：
 * - `provideSettingHost()` **必须在** `provideClientChain()` **之前**：它提供的 `configForms` 是链的
 *   必需前置（链内的 `Locale` / `Theme` 按契约要它），缺了链根本起不来；
 * - `provideTheme()` **必须紧跟**链之后（晚于 `configForms`）：`ui-theme` 在 apply 期同步读
 *   `ctx.configForms`，读不到只订阅一次 `undefined`、不重试；
 * - `provideLayout()` **必须跟在 `provideTheme()` 之后**：链不再自带渲染面，而 `ui-layout` 在 apply 期
 *   同步读 `ctx.theme`，漏装或不按序装的表现是"界面一片空白"而不是报错；
 * - `provideModelSelectionSlots()` **必须** 在会话界面与 `provideCommandUi()` 之后（要 `sessions` / `slots` /
 *   `locale` / `remote` 就位）。
 * @param features - 叠加在 framework 链上的清单变换（测试用它把连接指向随机端口；应用本身不需要）。
 * @returns provider 清单。
 */
export function appClientProviders(...features: ProviderFeature[]): ProviderEntry[] {
  return [
    // 连接行单独先挂（链里其余行从 `without` 剔掉它）：
    // 设置入口行的上游（`ui-settings` 的 `SettingsDescribeMirror`）在 **apply 期**就调 `remote.describe`，
    // 而 `Remote` 的传输要到它自己被激活之后才拿到 `Connection` 实例——连接排在设置行后面时，
    // 那次调用会退回 `location.origin` 建 mux（非浏览器宿主直接连错地址，症状是"数据永远是空的"）。
    ...provideClientConnection(...features),
    ...provideClientRemote(),

    // 设置入口行（`configForms` 的真实现）。**必须排在 `locale` / 主题之前**（它们要它的面），
    // 又必须排在 `remote` 之后：它的上游在 apply 期就调 `remote.describe`。
    ...provideSettingHost(),

    // framework 链的其余行（slots / locale / 渲染面 …）：连接与 remote 已单独装过，按实现类剔除。
    ...provideClientChain(
      // `without()` 一次只剔一个实现类。
      without(ClientConnectionDefault),
      without(RemoteDefault),
      without(SessionRemoteDefault),
      without(SessionRemoteBinding),
    ),

    // 渲染面与设置面板的位置（`ui-theme` → `ui-layout` 在 apply 期同步读，顺序即依赖）：
    // - `provideTheme()`：主题服务（`configForms` 已由最前面的设置行给出）；
    // - `provideLayout()`：链**不再**自带渲染面（布局在 apply 期读 `ctx.theme`），必须在这里装；
    // - `provideSettingSlots()`：通用页 + 模型页的位置（要上面两者的 `configForms`）。
    ...provideTheme(),
    ...provideLayout(),
    ...provideSettingSlots(),

    // 数据面（两者互不依赖，可并列）：
    // - `provideSessions()` 出 `sessions`（`SessionController`：目录 / 绑定 / 命令转发）；
    //   它自带 `provideProjections()`（为了非浏览器宿主也能单独装），但这条链里 `projections` 已由
    //   `provideClientChain()` 提供——同名服务注册两次会直接抛，所以按实现类剔除它那份。
    // - `provideWorkspaceUi()` 出 `workspaces`（`WorkspaceController`）+ `WorkspaceRemoteBinding`。
    ...provideSessions(without(ProjectionsDefault)),
    ...provideWorkspaceUi(),

    // 壳。**顺序有依赖**：
    // - `provideSessionShell()`（`SessionLayout`）先跑：它包装上游 `ui-session`，产出 `uiSession`；
    // - `provideSessionShellSlots()` 里的侧栏行要 `uiWorkspace`（新建会话按钮走
    //   `uiWorkspace.startSession()`），而它来自 `provideWorkspaceSlots()` → 必须排其后；
    //   侧栏还 `inject(Layout)`，所以也要排在 `provideLayout()` 之后。
    ...provideSessionShell(),
    ...provideWorkspaceSlots(),
    // 侧栏骨架属于会话域（在 `dsh-session/ui` 里），装配面只组合、不自己写。
    ...provideSessionShellSlots(),

    // 会话界面：主视图、内容渲染、会话内卡片。
    // `ConversationSlots` 在这一组里，它包装上游 `ui-conversation` 并产出 `conversation` /
    // `uiConversation`——**同组的 `ScheduleSlots` 等行 `inject(Conversation)` 依赖它**，
    // 所以这一组内部靠 `resolvePending` 的令牌解析排定，外部不必再拆。
    ...provideSessionSlots(),

    // 命令面先于输入区：`provideCommandUi()` 里的 `CommandRemoteBinding` 要把 `commands` 组的
    // descriptor 挂到客户端 `remote` 上（`remote.commands`），而输入区那一组的 `CommandUiSlot`
    // 装的是上游 `ui-commands`——它的 `static inject` 里就有 `remote.commands`，反了它就不激活。
    ...provideCommandUi(),
    // 输入区：附件运行时（`FileUploadRuntime` → `fileUpload`）+ 触发器 + 命令 UI 行 + `@` 引用。
    ...provideSessionInputSlots(),

    // 输入区的模型选择器。要 `sessions`（上面）+ `slots`/`locale`/`remote` + 命令面就位——
    // 它读 `modelDirectories`（上游 `ui-model-selection` 的 client 服务），并把座位挂到输入栏。
    ...provideModelSelectionSlots(),

    // 权限面板。**必须排在设置之后**：它的 `describeFace` 来自设置行的共享 mirror；
    // 排在前面的后果不是报错，而是"确认按钮点了不发写入"（`view === undefined` 直接早退）。
    // `provideApproval()` 紧跟：批准弹层复用同一个权限面。
    ...providePermissionUi(),
    ...provideApproval(),

    // 其它领域的会话内卡片。都挂在会话界面已经声明的位置上（`conversation.*` / `sidebarRight`），
    // 所以必须排在 `provideSessionSlots()` 之后；彼此之间互不依赖。
    ...provideUserQuestionsSlots(),
    ...provideSkillUi(),
    ...provideGoalUi(),
  ];
}
