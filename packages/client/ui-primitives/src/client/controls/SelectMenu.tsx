// 选择器：官方 `Menu` 配一个显示当前值的触发按钮（值不在候选里时按值本身显示，空串显示"没写"那一项）。
// 官方 `Menu` 只管浮层与键盘，触发按钮与"没写"这一档由这里补齐——设置面上到处都要这一对。

import { useState, type ReactNode } from "react";
import { Button, Menu, type MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives";
import { styling } from "../styling/styling.ts";
import { styles } from "./controls.styles.ts";

// 一项候选：值是写进配置的那份，label 是给人看的（缺省显示值本身）。
export interface SelectMenuOption {
  readonly value: string;
  readonly label?: string | undefined;
}

export interface SelectMenuProps {
  // 无障碍名（触发按钮的名字）。
  label: string;
  // 当前值；空串表示这一项没写（触发按钮显示 `emptyLabel`）。
  value: string;
  // 没写时触发按钮显示的那句话（例如"不写"）。
  emptyLabel: string;
  // 候选；菜单第一项是"没写"（选它等于清掉）。
  options: readonly SelectMenuOption[];
  disabled?: boolean;
  // 选中一项；空串 = 清掉这一项。
  onSelect: (next: string) => void;
}

export function SelectMenu({
  label,
  value,
  emptyLabel,
  options,
  disabled = false,
  onSelect,
}: SelectMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const items: readonly MenuEntry[] = [
    { id: "", label: emptyLabel },
    ...options.map((option) => ({
      id: option.value,
      label: option.label ?? option.value,
    })),
  ];
  const current = options.find((option) => option.value === value);
  return (
    <Menu
      open={open}
      anchor={
        <Button
          variant="outline"
          size="sm"
          className={styling.className(styles.controlHeight)}
          data-action="pick"
          disabled={disabled}
          aria-haspopup="menu"
          aria-label={label}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {value === "" ? emptyLabel : (current?.label ?? value)}
        </Button>
      }
      items={items}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false);
        onSelect(id);
      }}
      onClose={() => {
        setOpen(false);
      }}
    />
  );
}
