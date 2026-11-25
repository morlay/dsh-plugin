// 正文座位：一个标签的内容（按类型 id 派发到 `sidebar.right.pane.tab` 的那条注册）。
//
// 认领不到类型的正文（类型行没装）是**真实状态**，不是缺陷：说清它，比给一片空白强。
import type { ReactNode } from "react";
import css from "./rightbar.module.css";

/** 正文座位的 props。 */
export interface RightbarPaneTabProps {
  /** 已渲染的正文（座位渲染结果）；没有就是 `null` / `undefined`。 */
  readonly content: ReactNode;
  /** 没有正文时的说明文案。 */
  readonly unavailable: string;
}

/**
 * 正文区域。
 * @param props - 正文内容与缺口说明。
 * @returns 正文元素。
 */
export function RightbarPaneTab({ content, unavailable }: RightbarPaneTabProps): ReactNode {
  return (
    <div className={css.body} data-role="rightbar-body">
      {content === undefined || content === null ? <p className={css.notice}>{unavailable}</p> : content}
    </div>
  );
}
