// 应用侧的 client 装配（**只有装配**）：框架链 + 业务链 + 各域的前端行。
//
// 上游 UI 行按**它服务的领域**放在各自包里（会话界面在 `dsh-session`、设置面板在 `dsh-setting`、
// 命令弹层在 `dsh-command/ui`…），这里只决定**装哪些、按什么顺序装**。
import type { ProviderEntry } from "@morlay/zephyr";
import { provideClientChain, provideTheme } from "@morlay/zephyr-app/client";
import {
  provideModelSelectionSlots,
  provideSettingHost,
  provideSettingSlots,
  SettingsHost,
} from "@morlay/dsh-setting/ui";
import { providePermissionUi, provideApproval, provideUserQuestionsSlots } from "@morlay/dsh-permission/ui";
import { provideCommandUi } from "@morlay/dsh-command/ui";
import { provideGoalUi } from "@morlay/dsh-goal/ui";
import { providePlanModeUi } from "@morlay/dsh-plan-mode/ui";
import { provideSkillUi } from "@morlay/dsh-skill/ui";
import {
  provideSessionInputSlots,
  provideSessionShell,
  provideSessionSlots,
  provideSessions,
} from "@morlay/dsh-session/ui";
import { provideWorkspaceSlots, provideWorkspaceUi } from "@morlay/dsh-workspace/ui";
import { SidebarRightSlots, SidebarSlots } from "./shell/index.ts";

/**
 * 应用侧 client 清单：框架链 + 业务链 + 各域前端行。
 *
 * 顺序 = 依赖（提供方在前）；跨包的两处硬约束用注释钉住，别"看起来能跑"就重排：
 * - `provideSettingHost()` **必须在** `provideTheme()` 之前（`ui-theme` 在 apply 期同步读 `ctx.configForms`，
 *   读不到只订阅一次 `undefined`、不重试）；
 * - `provideModelSelectionSlots()` **必须** 在会话界面与 `provideCommandUi()` 之后（要 `sessions` / `slots` /
 *   `locale` / `remote` 就位）。
 * @returns provider 清单。
 */
export function appClientProviders(): ProviderEntry[] {
  return [
    // framework 链（remote / locale / slots / 渲染面）
    ...provideClientChain(),

    // 数据面：会话目录、工作区
    ...provideSessions(),
    ...provideWorkspaceUi(),

    // 壳：侧栏骨架 + 右侧面板 + 工作区位置
    ...provideSessionShell(),
    ...provideWorkspaceSlots(),
    SidebarSlots,
    SidebarRightSlots,

    // 设置：入口行 → 主题（必须紧跟）→ 设置页位置
    ...provideSettingHost(),
    ...provideTheme(),
    ...provideSettingSlots(),

    // 会话界面：主视图、内容渲染、会话内卡片
    ...provideSessionSlots(),

    // 输入区：附件运行时 + 触发器 + 斜杠命令（命令弹层）+ `@` 引用
    ...provideSessionInputSlots(),
    ...provideCommandUi(),

    // 输入区的模型选择器（要上面的会话面与命令面就位）
    ...provideModelSelectionSlots(),

    // 权限面板：它的 `describeFace` 来自设置行的共享 mirror，所以必须排在设置之后；
    // 排在前面的后果不是报错，而是"确认按钮点了不发写入"（`view === undefined` 直接早退）。
    ...providePermissionUi(),
    ...provideApproval(),

    // 其它领域的会话内卡片
    ...provideUserQuestionsSlots(),
    ...providePlanModeUi(),
    ...provideSkillUi(),
    ...provideGoalUi(),
  ];
}
