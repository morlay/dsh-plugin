// 页内的 tab 条（下划线那一档）：与官方会话头部的 tab 条同形——选中是品牌蓝文字 + 2px 下划线。
// 官方没有这个原子（`SegmentedTabs` 是分段控件那一档），所以住这里。

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import css from "./Tabs.module.css";

export interface TabItem {
  readonly value: string;
  readonly label: string;
}

export interface TabsProps {
  // 这一组的无障碍名。
  label: string;
  items: readonly TabItem[];
  // 当前选中的那个。
  value: string;
  onChange: (value: string) => void;
  // 无障碍角色：切视图用 `tablist`，切口径（时间范围这类）用 `radiogroup`。
  role?: "tablist" | "radiogroup";
  disabled?: boolean;
}

export function Tabs({
  label,
  items,
  value,
  onChange,
  role = "tablist",
  disabled = false,
}: TabsProps): ReactNode {
  return (
    <div className={css.tabs} role={role} aria-label={label}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role={role === "tablist" ? "tab" : "radio"}
            data-tab={item.value}
            aria-selected={role === "tablist" ? active : undefined}
            aria-checked={role === "tablist" ? undefined : active}
            disabled={disabled}
            className={classes(css.tab, active ? css.tabActive : undefined)}
            onClick={() => {
              onChange(item.value);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
