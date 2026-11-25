// 右栏的**默认页**（guide）：上游 `defaultSeed` 在空列里种的就是它。
//
// `defaultSeed(tabs)` 的规则是「`tabs.guide()` 唯一条目，否则 `GUIDE_KIND`」——guide 是默认页，
// 不需要谁引用它，但**必须注册**：没有它，任何展开都会抛 `default tab kind "guide" is not registered`。
//
// 正文只做空态：上游 `GuideBody` 依赖 chain 与 `useTabInfo` 的 hook context（只有上游 `RightbarSeat` 会传），
// 在我们自己的容器里复用会崩——完整 guide 等右栏 UI 整体迁到会话域那一票。
import { GUIDE_KIND } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/seed.ts";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { RightbarGuide } from "@morlay/zephyr-ui";
import { Locale } from "../locale/locale.contract.ts";
import { Slots } from "../renderer/slots.contract.ts";
import { SidebarRightTabs } from "./sidebar-right-tabs.contract.ts";

/** 本行字典的命名空间（与右栏动作面同一份）。 */
const NS = "rightbar";

/** 右栏默认页：类型注册 + 空态正文座位。 */
@Injectable()
export class GuideSeat implements OnInit, OnDispose {
  /** 类型注册表：guide 自己就是一条 builtin 类型。 */
  private readonly tabs = inject(SidebarRightTabs);

  /** 槽位注册表：正文挂在 keyed 的 `sidebar.right.pane.tab` 上。 */
  private readonly slots = inject(Slots);

  /** 文案。 */
  private readonly locale = inject(Locale);

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
            inject: () => ({ title: t("guide.title"), empty: t("guide.empty") }),
          } as never,
          RightbarGuide as never,
        ),
      ),
    );
  }

  /** 卸载：撤注册。 */
  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
