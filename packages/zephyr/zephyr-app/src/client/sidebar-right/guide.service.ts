// 右栏的**默认页**（guide）：上游 `defaultSeed` 在空列里种的就是它。
//
// `defaultSeed(tabs)` 的规则是「`tabs.guide()` 唯一条目，否则 `GUIDE_KIND`」——guide 是默认页，
// 不需要谁引用它，但**必须注册**：没有它，任何展开都会抛 `default tab kind "guide" is not registered`。
//
// 正文用上游原件（`GuideBody`）：它的胶囊来自各类型注册时带的 `guide` 条目，我们没提供 → 它渲染
// 自己的空态（「没有可用标签」那一屏）。标题不注册，容器用记录里的 `title` 兜底。
import { GUIDE_KIND } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/seed.ts";
import { createGuidePins } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tabs/guide/guide-pins.ts";
import { GuideBody } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { Locale } from "../locale/locale.contract.ts";
import { Slots } from "../renderer/slots.contract.ts";
import { Shortcuts } from "../shortcuts/shortcuts.contract.ts";
import { SidebarRightTabs } from "./sidebar-right-tabs.contract.ts";

/** 本行字典的命名空间（与右栏动作面同一份）。 */
const NS = "rightbar";

/** 右栏默认页：类型注册 + 正文座位（上游 `GuideBody`）。 */
@Injectable()
export class GuideSeat implements OnInit, OnDispose {
  /** 类型注册表：guide 自己就是一条 builtin 类型。 */
  private readonly tabs = inject(SidebarRightTabs);

  /** 槽位注册表：正文挂在 keyed 的 `sidebar.right.pane.tab` 上。 */
  private readonly slots = inject(Slots);

  /** 文案（类型标题用本行字典）。 */
  private readonly locale = inject(Locale);

  /** 快捷键目录：guide 胶囊上的键位提示读它。 */
  private readonly shortcuts = inject(Shortcuts);

  /** guide 卡片的钉住状态（内存里，插件重载即清）。 */
  private readonly pins = createGuidePins();

  /** 本行注册的撤销函数。 */
  private readonly disposers: (() => void)[] = [];

  /** 注册 guide 类型与它的正文座位。 */
  onInit(): void {
    const t = this.locale.bind(NS);
    this.disposers.push(
      this.tabs.register({
        id: GUIDE_KIND,
        kind: GUIDE_KIND,
        priority: "builtin",
        title: () => t("guide.title"),
      }),
    );
    this.disposers.push(
      this.slots.inject("sidebar.right.pane.tab", () =>
        this.slots.register(
          {
            name: "sidebar.right.pane.tab",
            key: GUIDE_KIND,
            locale: "sidebarRight",
            children: {
              "sidebar.right.tab.guide.actions": { kind: "list", scope: "root" },
              "sidebar.right.tab.guide.entry": { kind: "keyed", scope: "session" },
              "sidebar.right.tab.guide": { kind: "chain", scope: "session" },
            },
            inject: () => ({
              hooks: {
                shortcuts: this.shortcuts.catalog,
                guideEntries: {
                  getSnapshot: () => this.tabs.face.guide(),
                  subscribe: (listener: () => void) => this.tabs.subscribe(listener),
                },
                entryPins: this.pins.unpinned,
                entryActions: {
                  getSnapshot: () => this.slots.entriesOfSlot("sidebar.right.tab.guide.actions").length > 0,
                  subscribe: (listener: () => void) => this.slots.subscribe("sidebar.right.tab.guide.actions", listener),
                },
              },
              setPinned: this.pins.setPinned,
            }),
          } as never,
          GuideBody as never,
        ),
      ),
    );
  }

  /** 卸载：撤注册。 */
  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
