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
} from "@morlay/zephyr-app/client";
import { provideSettingHost, provideSettingUi } from "@morlay/dsh-conversation/ui";
import {
  providePermissionUi,
  provideApproval,
  provideUserQuestionsSlots,
} from "@morlay/dsh-conversation/ui";
import { provideCommandUi } from "@morlay/dsh-command/ui";
import { provideSkillUi } from "@morlay/dsh-skill/ui";
import {
  provideConversationUi,
  provideSessionShell,
  provideSessionStatusUi,
  provideSessions,
} from "@morlay/dsh-conversation/ui";
import { provideWorkspaceUi } from "@morlay/dsh-workspace/ui";
import { provideDeliverablesUi } from "@morlay/dsh-conversation/ui";
import { provideAgentTeamUi } from "@morlay/dsh-agent-team/ui";
import { provideFileUploadUi } from "@morlay/dsh-upload/ui";
import { provideJobUi } from "@morlay/dsh-job/ui";
import { provideSessionModeUi } from "@morlay/session-mode/ui";
import { provideBetterSessionUi } from "@morlay/session-rdb/ui";
import { provideDesktopPanelUi } from "@morlay/zephyr-desktop-panel/ui";

/**
 * 应用侧 client 清单：框架链 + 业务链 + 各域前端行。
 *
 * 顺序**不是**手写的硬约束：`bootstrapApplication` 按 `inject` 声明做拓扑排序（`bootstrap.ts` 的
 * `orderByDependencies`），提供者一定排在消费者之前；清单里的位置只是**同层基准**（排序保持原序），
 * 写出来是为了读得懂。下面只记「谁提供、谁消费」，不记「必须排在哪」：
 * - `provideSettingHost()` 提供 `configForms`（链内 `Locale` / `Theme` 都 `inject(ConfigForms)`）；
 *   它与 `provideSettingUi()`（页面位置 + 模型选择器）拆开是**职责**：一个是面，一个是页面；
 * - `provideTheme()` 消费 `configForms`、`provideLayout()` 消费 `theme`——同一条边，同样由排序保证；
 * - `provideSettingUi()` 里的模型选择器消费 `sessions` / `slots` / `locale` / `remote`。
 * @param features - 叠加在 framework 链上的清单变换（把连接指向别的宿主时用；应用本身不传）。
 * @returns provider 清单。
 */
export function appClientProviders(...features: ProviderFeature[]): ProviderEntry[] {
  return [
    // 连接行单独先挂（链里的同名行用 `without` 剔掉，避免注册两次）：`Remote` 注入 `Connection`、
    // 设置入口行注入 `Remote`，先后由拓扑排序保证。反序的代价：`SettingsDescribeMirror` 在 apply 期
    // 就调 `remote.describe`，拿不到 `Connection` 时那次调用会退回 `location.origin` 建 mux
    // （非浏览器宿主直接连错地址，症状是"数据永远是空的"）。
    ...provideClientConnection(...features),
    ...provideClientRemote(),

    // 设置面的**入口行**（`configForms` / `settingsSchema` 的真实现）：链内 `Locale` / `Theme` 都
    // `inject(ConfigForms)`，拓扑排序会把本行排到它们之前。放在链前只是同层基准（读起来顺），
    // 不是硬约束；本行自己 `inject(Remote)`，同样由排序保证在 remote 之后。
    ...provideSettingHost(),

    // framework 链的其余行（slots / locale / 渲染面 …）：连接与 remote 已单独装过，按实现类剔除。
    ...provideClientChain(
      // `without()` 一次只剔一个实现类。
      without(ClientConnectionDefault),
      without(RemoteDefault),
    ),

    // 渲染面（`Theme` 注入 `configForms`、`Layout` 注入 `theme`：同一条边，由排序保证提供者在消费者前）：
    // - `provideTheme()`：主题服务；
    // - `provideLayout()`：链**不再**自带渲染面，布局要在这里装（漏装是"界面一片空白"，不是报错）；
    //   设置页的位置（通用页 + 模型页）由 `provideSettingUi()` 注册，见那一段。
    ...provideTheme(),
    ...provideLayout(),

    // 数据面（两者互不依赖，可并列）：
    // - `provideSessions()` 出 `sessions`（`SessionController`：目录 / 绑定 / 命令转发）；
    //   它自带 `provideProjections()`（为了非浏览器宿主也能单独装），但这条链里 `projections` 已由
    //   `provideClientChain()` 提供——同名服务注册两次会直接抛，所以按实现类剔除它那份。
    // - `provideWorkspaceUi()` 出 `workspaces`（`WorkspaceController`）+ 两组端点的客户端形态（各自 `onInit` 挂载）。
    ...provideSessions(without(ProjectionsDefault)),
    // **`uiSession` 与其子服务要先于工作区面**：上游 `ui-workspace` 的 inject 声明里有
    // `uiSession` 与 `uiSession.sessionStatus`（未读标记），它读的是 `ctx.uiSession.sessionStatus`。
    ...provideSessionShell(),
    ...provideSessionStatusUi(),
    // 工作区面（含侧栏工作区列表与上下文菜单）：`uiWorkspace` 是会话侧栏骨架的前置。
    ...provideWorkspaceUi(),

    // 壳。**顺序有依赖**：
    // - `provideSessionShell()`（`SessionLayout`）先跑：它包装上游 `ui-session`，产出 `uiSession`；
    // - `provideSessionShellSlots()` 里的侧栏行要 `uiWorkspace`（新建会话按钮走
    //   `uiWorkspace.startSession()`），而它来自 `provideWorkspaceSlots()` → 必须排其后；
    //   侧栏还 `inject(Layout)`，所以也要排在 `provideLayout()` 之后。
    // 会话界面（布局 + 侧栏骨架 + 主视图 + 输入区）与命令面：命令面必须在它之前——
    // 输入区那一组的 `CommandUiSlot` 注入 `remote.commands`（由 `provideCommandUi()` 挂上）。
    ...provideCommandUi(),
    ...provideConversationUi(),

    // 交付物卡片 + 右栏「交付物」标签：行的 home 在 deliverables 域，注册进会话界面已声明的位置。
    ...provideDeliverablesUi(),

    // 附件上传运行时（`fileUpload`）：行的 home 在 upload 域，它装进会话界面的输入区。
    ...provideFileUploadUi(),
    // 设置的**页面位置与模型选择器**：与入口行 `provideSettingHost()` 是职责拆分（面在前、页面在后），
    // 不是顺序约束；这里的位置只是同层基准——`configForms` 由排序保证先于消费者就位，
    // 模型选择器消费 `sessions` / `commandUi`。
    ...provideSettingUi(),

    // 权限面板：`UiPermission` 注入 `configForms` / `settingsSchema`（都由链前的 `provideSettingHost()`
    // 提供，排序保证）以及 `sessions` / `commandUi`；这里的位置只是同层基准。缺那份面不是报错，
    // 而是"确认按钮点了不发写入"（`view === undefined` 直接早退）。
    // `provideApproval()` 紧跟：批准弹层复用同一个权限面。
    ...providePermissionUi(),
    ...provideApproval(),

    // 后台任务的浏览器半：数据面（`jobs`，挂 `job` 那组 remote）+ 会话头部的任务列表
    // （`conversation.session.header.actions` 的 `job-list`）。宿主半 `provideJob()` 已在
    // `zephyr.provide.ts` 里（注册表 + `job_list` 一族工具行）；缺这一半时模型能起后台任务，
    // 界面上却看不见、也没法 kill。
    ...provideJobUi(),

    // 其它领域的会话内卡片。都挂在会话界面已经声明的位置上（`conversation.*` / `sidebarRight`），
    // 所以必须排在 `provideSessionSlots()` 之后；彼此之间互不依赖。
    ...provideUserQuestionsSlots(),
    ...provideSkillUi(),

    // 我们的会话扩展：模式 chip（composer 工具行左侧）+ 右栏模式面板；消息动作（编辑 / 重试）
    // + 对话管理页（`main` 的 conversations 键 + 侧栏面板列）。都注册在官方行已声明的位置上，
    // 所以必须排在 `provideSessionSlots()` 与 `provideSessionShellSlots()` 之后。
    ...provideSessionModeUi(),
    ...provideBetterSessionUi(),
    // Agent Teams 的浏览器半：模型选择那一行的「团队模式」开关（`conversation.input.model.options`）
    // + 团队消息卡（`conversation.chat.commandview` 的 `team`）+ 关闭确认（`shell.overlay`）。
    // 宿主半 `provideAgentTeam()` 已在 `zephyr.provide.ts` 里（`agentTeams` 服务 + 团队工具行），
    // 这里只补 UI——两者缺一，模型选择里就看不到那个开关。
    ...provideAgentTeamUi(),
    // 桌面形态的内嵌浏览器面板（右栏一页）：网页容器由壳的主进程建，这里只是入口与地址栏。
    // 非桌面宿主里没有 `__DSH_BROWSER_PANE__`，正文退化成一块空占位（不报错）。
    ...provideDesktopPanelUi(),
  ];
}
