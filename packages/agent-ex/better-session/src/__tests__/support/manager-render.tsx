// 对话管理页 L3 的渲染座：真页面 + 装配给的 face，字典取本包 zh（页面文案的真源同一份）。
//
// 为什么单独一份：四个 L3 spec（归档 / 批量导入 / 定位 / 时间窗口）都要渲染同一页，
// 各抄一份字典插值与渲染只会让「页面怎么装"漂成四份。装配面仍归 `manager-flow.ts`。
import { render } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { ConversationManagerPage } from "../../ui/conversation-manager/conversation-manager-page.tsx";
import { zh } from "../../ui/conversation-manager/locales.ts";
import type { ConversationManagerKey } from "../../ui/conversation-manager/locales.ts";
import type { ManagerFlow } from "./manager-flow.ts";

/**
 * 本包字典的插值座（与页面收到的 `t` 同形）：`{name}` 用参数替换。
 * @param key - 字典键（`zh` 就是键的真源）。
 * @param args - 插值参数。
 * @returns 插值后的文案。
 */
export function managerTranslate(
  key: ConversationManagerKey,
  args?: Record<string, unknown>,
): string {
  const template: string = zh[key] ?? key;
  if (args === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(args[name]));
}

/**
 * 渲染对话管理页（真页面，动作面来自 `startManagerFlow()` 的装配）。
 * @param flow - 管理页的 L3 装配。
 * @returns 渲染容器。
 */
export function renderManagerPage(flow: ManagerFlow): HTMLElement {
  const Page = ConversationManagerPage as unknown as (props: Record<string, unknown>) => ReactNode;
  return render(createElement(Page, { t: managerTranslate, ...flow.face })).container;
}
