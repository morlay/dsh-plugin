// guide 正文：右栏默认页的**空态**（「这一列现在有什么」）。
//
// 上游 `GuideBody` 走的是 chain + `useTabInfo` 的渲染协议（hook context 只有上游 `RightbarSeat` 会传），
// 在自写容器里复用它会崩 `useTabInfo is not a function`——所以这里只做「没有可用标签」这一屏，
// 完整 guide（胶囊、More 菜单、钉住）等右栏 UI 整体迁到会话域那票（见 debts/20261126-右栏UI应归会话域.md）。
import type { ReactNode } from "react";
import css from "./rightbar.module.css";

/** guide 空态的 props。 */
export interface RightbarGuideProps {
  /** 页面标题。 */
  readonly title: string;
  /** 一个类型都没有时的说明。 */
  readonly empty: string;
}

/**
 * 右栏默认页的空态。
 * @param props - 标题与说明。
 * @returns 引导内容。
 */
export function RightbarGuide({ title, empty }: RightbarGuideProps): ReactNode {
  return (
    <div data-role="rightbar-guide">
      <p className={css.guideTitle}>{title}</p>
      <p className={css.notice}>{empty}</p>
    </div>
  );
}
