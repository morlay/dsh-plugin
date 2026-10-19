// client 链的装配顺序：提供方在前（Connection → Typert → Remote → ConfigForms → Slots → Locale →
// FileDrag → Shortcuts → Layout）。
//
// **`provideTheme()` 不在这里**：`ui-theme` 在 apply 期**同步**读 `ctx.configForms`，而真实现由
// `ui-settings` 行（`SettingsHost`）提供。它必须在 `SettingsHost` 之后启动，所以由应用装配按顺序装
// （见 `apps/dsh-custom-next/src/zephyr.ts` 的注释）。
import { inject, Injectable, provide } from "@morlay/zephyr";
import { provideClientConnection } from "./connection/index.ts";
import { provideClientTypert } from "./typert/index.ts";
import { provideClientRemote } from "./remote/index.ts";
import { provideResources } from "./resources/index.ts";
import { provideConfigForms } from "./settings/index.ts";
import { provideAccess } from "./remote-access/index.ts";
import { provideRenderer } from "./renderer/provide.ts";
import { provideLocale } from "./locale/index.ts";
import { provideFileDrag } from "./file-drag/provide.ts";
import { provideShortcuts } from "./shortcuts/index.ts";
import { provideLayout } from "./layout/index.ts";
import { Theme } from "./theme/index.ts";

/**
 * 依赖哨兵：`layout` 行 `inject("theme")`，而 `theme` 由**外层**装的 `provideTheme()` 提供。
 *
 * 没有这个哨兵时，漏装 `provideTheme()` 的错误会以 `✗ layout: service "theme" is not available` 出现——
 * 它说的是 `layout`，看不出「你装的是 `provideClientChain()`、漏的是 `provideTheme()`」。
 * 这个 provider 把要求写在 `provideClientChain()` 自己身上：缺 `theme` 时装配期直接报
 * `✗ client-chain: service "theme" is not available`。
 */
@Injectable()
class ClientChainRequiresTheme {
  private readonly theme = inject(Theme);
}

export const provideClientChain = provide([
  ...provideClientConnection(),
  ...provideClientTypert(),
  ...provideClientRemote(),
  ...provideResources(),
  ...provideAccess(),
  // 这里装的是**空实现**（没有宿主文档时表单不可用）。它的真实现由上游 `ui-settings` 行提供：
  // 那一行列在应用装配的最前面，它的 `configForms` 会覆盖这里的空实现，
  // 之后激活的行读到的就是真实现。
  ...provideConfigForms(),
  ...provideRenderer(),
  ...provideLocale(),
  // `fileDrag` 依赖 `locale`（文案）与 `slots`（失败提示的 overlay）：排在 Locale 之后。
  ...provideFileDrag(),
  ...provideShortcuts(),
  ...provideLayout(),
  ClientChainRequiresTheme,
]);
