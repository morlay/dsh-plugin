// 角位展开按钮：面板收起时它是唯一的入口（放在会话头的角位，不占工具行的位置）。
//
// 图标是左栏折叠图标的镜像——同一个动作，在另一条边上。
import type { ReactNode } from "react";
import { IconPanelLeftOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { IconButton } from "../controls/IconButton.tsx";
import css from "./rightbar.module.css";

/** 展开按钮读的最小视图（容器视图的子集）。 */
export interface RightbarExpandView {
  /** 面板是否已经展开。 */
  readonly expanded: boolean;
}

/** 展开按钮的 props。 */
export interface RightbarExpandProps {
  /** 读右栏视图（框架绑定的 selector hook）。 */
  readonly useRightbar: <T>(select: (view: RightbarExpandView) => T) => T;
  /** 无障碍名。 */
  readonly label: string;
  /** 展开面板。 */
  readonly onExpand: () => void;
}

/**
 * 展开右栏的按钮。
 * @param props - 视图 hook、名字与动作。
 * @returns 按钮；已展开时是 `null`。
 */
export function RightbarExpand({ useRightbar, label, onExpand }: RightbarExpandProps): ReactNode {
  const expanded = useRightbar(view => view.expanded);
  if (expanded) return null;
  return (
    <IconButton label={label} shape="circle" size="sm" onClick={onExpand} data-role="rightbar-expand">
      <IconPanelLeftOutlineRegular className={css.expandIcon} />
    </IconButton>
  );
}
