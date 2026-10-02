// 标签输入（multi-input 的 searchable 形态）：一个框包住所有标签与那一个内联输入框，**聚焦即整体下拉候选**，
// 输入同时过滤候选；回车确认一个（可以是候选里没有的自定义值），点候选也加一个。
//
// 已经在名单里的值不再出现在候选里（见 `remaining`）；粘贴一串会拆成多个（见 `./tags.ts` 的分隔符口径）。

import { useMemo, useState, type ReactNode } from "react";
import {
  IconCloseOutlineRegular,
  Menu,
  MenuItemButton,
  rankByName,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { type SearchSelectOption } from "./SearchSelect.tsx";
import { mergeTags, parseTagList } from "./tags.ts";
import css from "./TagInput.module.css";

export interface TagInputProps {
  // 当前名单。
  value: readonly string[];
  // 整段替换（一次粘贴 / 回车 / 点候选 / 移除就是一次编辑动作）。
  onChange: (next: string[]) => void;
  // 候选（可空）：不空时聚焦就下拉；已经在名单里的项不再列出。
  options?: readonly SearchSelectOption[] | undefined;
  // 空框时的提示。
  placeholder: string;
  // 框内输入框的无障碍名。
  label: string;
  disabled?: boolean;
  // 候选都没匹配上时的那句话。
  noMatchLabel?: string;
  // 一个标签的移除按钮名（文案归调用方：它要带标签名）。
  removeLabel: (name: string) => string;
}

export function TagInput({
  value,
  onChange,
  options,
  placeholder,
  label,
  disabled = false,
  noMatchLabel = "",
  removeLabel,
}: TagInputProps): ReactNode {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const commit = (text: string): void => {
    const names = parseTagList(text);
    if (names.length === 0) return;
    onChange(mergeTags(value, names));
    setDraft("");
  };
  // 没加进去的那些才出现在候选里（加过的、以及手输过的自定义值都不再重复出现）。
  const remaining = useMemo(
    () =>
      (options ?? [])
        .filter((option) => !value.includes(option.value))
        .map((option) => ({
          value: option.value,
          name: option.label ?? option.value,
          label: option.value,
        })),
    [options, value],
  );
  const matches = useMemo(() => rankByName(remaining, draft), [remaining, draft]);
  return (
    <div className={css.row} data-role="tag-input" data-control="tags">
      <Menu
        open={open && remaining.length > 0}
        // 官方那份 wrapper 是 `inline-flex`：不撑满的话框只有内容那么宽（见 `TagInput.module.css` 的 `.anchor`）。
        className={css.anchor}
        anchor={
          <div className={css.box}>
            {value.map((name) => (
              // 标签与里面的移除按钮是同一个整体：× 在框内，点它才移除。
              <span key={name} className={css.chip} data-tag={name}>
                {name}
                <button
                  type="button"
                  className={css.chipRemove}
                  data-action="remove-tag"
                  disabled={disabled}
                  aria-label={removeLabel(name)}
                  onClick={() => {
                    onChange(value.filter((candidate) => candidate !== name));
                  }}
                >
                  <IconCloseOutlineRegular size={10} />
                </button>
              </span>
            ))}
            {/* 裸输入：边框与背景归外面那个框，标签与它一起换行。 */}
            <input
              className={css.input}
              value={draft}
              placeholder={value.length === 0 ? placeholder : ""}
              aria-label={label}
              disabled={disabled}
              onFocus={() => {
                setOpen(true);
              }}
              onBlur={() => {
                setOpen(false);
              }}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commit(draft);
              }}
              onPaste={(event) => {
                // 只有真的一串才拦：单个名字照旧走普通输入（粘进去还能接着改）。
                const text = event.clipboardData.getData("text");
                if (parseTagList(text).length < 2) return;
                event.preventDefault();
                commit(text);
              }}
            />
          </div>
        }
        onClose={() => {
          setOpen(false);
        }}
      >
        {matches.map((candidate) => (
          // 按下就保持输入框焦点（否则 blur 先把下拉收起来，点不到这一行），选中后继续留在框里加下一个。
          <span
            key={candidate.value}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
          >
            <MenuItemButton
              onSelect={() => {
                commit(candidate.value);
              }}
            >
              {candidate.name}
            </MenuItemButton>
          </span>
        ))}
        {matches.length === 0 ? (
          <p className={css.empty} data-role="tag-input-empty">
            {noMatchLabel}
          </p>
        ) : null}
      </Menu>
    </div>
  );
}
