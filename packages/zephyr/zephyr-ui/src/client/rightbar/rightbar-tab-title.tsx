// 一个标签：标题座位（keyed，按类型 id）在前、关闭按钮在后。
//
// 标题座位是**可选**的：类型没注册标题就用记录里开 tab 时抓到的 `title`（`fallback`）。
import type { ReactNode } from "react";
import { IconButton } from "../controls/IconButton.tsx";
import { IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import css from "./rightbar.module.css";

/** 一个标签的 props。 */
export interface RightbarTabTitleProps {
  /** 记录里的标题（标题座位没注册时的兜底）。 */
  readonly title: string;
  /** 这个标签的标题座位内容（已按类型 id 渲染好）。 */
  readonly titleSlot: ReactNode;
  /** 是否选中。 */
  readonly active: boolean;
  /** 关闭按钮的无障碍名。 */
  readonly closeLabel: string;
  /** 点标签（选中它）。 */
  readonly onSelect: () => void;
  /** 点关闭。 */
  readonly onClose: () => void;
}

/**
 * 标签条上的一个 chip。
 * @param props - 标题、选中态与两个动作。
 * @returns 标签元素。
 */
export function RightbarTabTitle({
  title,
  titleSlot,
  active,
  closeLabel,
  onSelect,
  onClose,
}: RightbarTabTitleProps): ReactNode {
  return (
    <span className={active ? `${css.tab} ${css.tabActive}` : css.tab} data-role="rightbar-tab">
      <button type="button" className={css.tabTitle} onClick={onSelect} data-role="rightbar-tab-title">
        {titleSlot === undefined || titleSlot === null ? title : titleSlot}
      </button>
      <IconButton label={closeLabel} size="sm" onClick={onClose} data-role="rightbar-tab-close">
        <IconCloseOutlineRegular />
      </IconButton>
    </span>
  );
}
