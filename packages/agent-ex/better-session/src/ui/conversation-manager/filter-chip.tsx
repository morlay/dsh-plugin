// 过滤 chip：上游一级页面那套（28px 胶囊，选中那档带填充 + 主标签色）。语义是**筛选**：
// `role="group"` 的组里每个 chip 用 `aria-pressed` 说选中，不是 tab 条。
import type { ReactNode } from "react";
import frameCss from "./conversation-manager-page.module.css";

export interface FilterChipProps {
  active: boolean;
  label: string;
  // `data-tab` 标注（沟通与 e2e 按它定位那一个 chip）。
  tab?: string | undefined;
  onSelect: () => void;
}

export function FilterChip({ active, label, tab, onSelect }: FilterChipProps): ReactNode {
  return (
    <button
      type="button"
      className={
        active ? frameCss.filterTab + " " + String(frameCss.filterTabActive) : frameCss.filterTab
      }
      aria-pressed={active}
      {...(tab === undefined ? {} : { "data-tab": tab })}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
