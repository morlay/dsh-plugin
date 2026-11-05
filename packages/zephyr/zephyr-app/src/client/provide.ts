// client 链的装配顺序：提供方在前（Connection → Typert → Remote → Slots → Resources → Access →
// ConfigForms → Locale → Projections → FileDrag → Shortcuts）。
//
// `Slots` 必须排在 `Resources` / `Access` 之前：`SlotContribution.onInit` 里就要往注册表里写
// （`slots.effect`），那要求 `SlotsDefault` 的行 ctx 已经就位——清单顺序就是激活顺序，写反了是启动期报错。
//
// **`provideTheme()` 与 `provideLayout()` 都不在这里**，因为它们的顺序不由链决定：
// `ui-theme` 在 apply 期**同步**读 `ctx.configForms`（读不到只订阅一次 `undefined`、不重试），
// 而 `configForms` 的真实现由装配面的 `SettingsHost` 给；`ui-layout` 又在 apply 期同步读 `ctx.theme`。
// 于是正确的顺序是「真 configForms → theme → layout」，只能由装配面写出来。
import { inject, Injectable, provide } from "@morlay/zephyr";
import { provideClientConnection } from "./connection/index.ts";
import { provideClientTypert } from "./typert/index.ts";
import { provideClientRemote } from "./remote/index.ts";
import { provideResources } from "./resources/index.ts";
import { provideAccess } from "./remote-access/index.ts";
import { provideRenderer } from "./renderer/provide.ts";
import { provideProjections } from "./projections/provide.ts";
import { provideLocale } from "./locale/index.ts";
import { provideFileDrag } from "./file-drag/provide.ts";
import { provideShortcuts } from "./shortcuts/index.ts";
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
  ...provideRenderer(),
  ...provideResources(),
  ...provideAccess(),
  // `configForms` **不在这里**：cordis store 里一个名字只能有一个提供者，链里塞空实现就等于
  // 让装配面再也装不进真实现（`SettingsHost`）。缺它是编译期错误（`Locale` / `Theme` 的必需注入），
  // 所以「忘了给配置面」在启动前就暴露，不靠运行期兜底。
  // 投影读面：排在 `remote` 与 `connection` 之后（它订阅 `session/control`、跟连接代换代）。
  ...provideProjections(),
  ...provideLocale(),
  // `fileDrag` 依赖 `locale`（文案）与 `slots`（失败提示的 overlay）：排在 Locale 之后。
  ...provideFileDrag(),
  ...provideShortcuts(),
  ClientChainRequiresTheme,
]);
