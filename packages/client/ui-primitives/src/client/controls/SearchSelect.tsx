// 可搜索选择器（searchable）：候选一多，"滚着找"就不够用了——打开后先给一行搜索框，按名字模糊过滤
// （官方 `rankByName`：前缀命中优先，其次对齐分数，最后保持来源顺序）。
//
// 它与标签输入（multi-input）共用同一套"搜索 + 候选"交互：TagInput 的「从候选里选」就是它的单值形态。

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  IconCheckOutlineRegular,
  Menu,
  MenuItemButton,
  rankByName,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { styling } from "../styling/styling.ts";
import { styles } from "./controls.styles.ts";

// 一项候选：值是写进配置的那份，label 是给人看的（也是搜索的第二个键）。
export interface SearchSelectOption {
  readonly value: string;
  readonly label?: string | undefined;
}

export interface SearchSelectProps {
  // 无障碍名（触发按钮的名字）。
  label: string;
  // 当前值；空串表示这一项没写（触发按钮显示 `emptyLabel`）。
  value: string;
  // 没写时触发按钮显示的那句话（例如"不写"），它也是候选里的第一项（选它 = 清掉）。
  emptyLabel: string;
  options: readonly SearchSelectOption[];
  disabled?: boolean;
  // 搜索框的占位与无障碍名。
  searchLabel: string;
  // 一个候选都没匹配上时的那句话。
  noMatchLabel: string;
  // 选中一项；空串 = 清掉这一项。
  onSelect: (next: string) => void;
}

export function SearchSelect({
  label,
  value,
  emptyLabel,
  options,
  disabled = false,
  searchLabel,
  noMatchLabel,
  onSelect,
}: SearchSelectProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  // 打开就落到搜索框上：候选多的时候，键盘直接开始打字。
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  const matches = useMemo(
    () =>
      rankByName(
        // 搜索键是显示名（`name`）与它本身（`label`，缺省时就是值）：`rankByName` 拿 name 与 label 双键匹配。
        options.map((option) => ({
          value: option.value,
          name: option.label ?? option.value,
          label: option.value,
        })),
        query,
      ),
    [options, query],
  );
  const current = options.find((option) => option.value === value);
  const close = (): void => {
    setOpen(false);
    setQuery("");
  };
  const pick = (next: string): void => {
    close();
    onSelect(next);
  };
  return (
    <Menu
      open={open}
      anchor={
        <Button
          variant="outline"
          size="sm"
          className={styling.className(styles.controlHeight, styles.buttonLabel)}
          data-action="pick"
          disabled={disabled}
          aria-haspopup="menu"
          aria-label={label}
          onClick={() => {
            if (open) close();
            else setOpen(true);
          }}
        >
          {value === "" ? emptyLabel : (current?.label ?? value)}
        </Button>
      }
      selectedId={value}
      onSelect={pick}
      onClose={close}
    >
      <div {...styling.props(styles.searchRow)}>
        <input
          {...styling.props(styles.searchInput)}
          ref={searchRef}
          value={query}
          aria-label={searchLabel}
          placeholder={searchLabel}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
      </div>
      <MenuItemButton
        icon={value === "" ? <IconCheckOutlineRegular /> : undefined}
        onSelect={() => {
          pick("");
        }}
      >
        {emptyLabel}
      </MenuItemButton>
      {matches.map((option) => (
        <MenuItemButton
          key={option.value}
          icon={option.value === value ? <IconCheckOutlineRegular /> : undefined}
          onSelect={() => {
            pick(option.value);
          }}
        >
          {option.name}
        </MenuItemButton>
      ))}
      {matches.length === 0 ? (
        <p {...styling.props(styles.searchEmpty)}>{noMatchLabel}</p>
      ) : null}
    </Menu>
  );
}
