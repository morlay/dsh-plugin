// 标签输入：一个框包住所有标签与那一个内联输入框，放不下就换行。回车确认一个；粘贴一串会拆成多个
// （见 `./tags.ts` 的分隔符口径）。有候选时右边给一个「从候选里选」的菜单，列出还没加进去的那些。

import { useState, type ReactNode } from "react";
import { IconCloseOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { styling } from "../styling/styling.ts";
import { styles } from "./controls.styles.ts";
import { SelectMenu, type SelectMenuOption } from "./SelectMenu.tsx";
import { mergeTags, parseTagList } from "./tags.ts";

export interface TagInputProps {
  // 当前名单。
  value: readonly string[];
  // 整段替换（一次粘贴 / 回车 / 移除就是一次编辑动作）。
  onChange: (next: string[]) => void;
  // 候选（可空）：不空时给「从候选里选」菜单；已经在名单里的项不再列出。
  options?: readonly SelectMenuOption[] | undefined;
  // 空框时的提示。
  placeholder: string;
  // 框内输入框的无障碍名。
  label: string;
  disabled?: boolean;
  // 候选菜单的触发文案（同时也是菜单的无障碍名）。
  candidatesLabel?: string;
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
  candidatesLabel = "",
  removeLabel,
}: TagInputProps): ReactNode {
  const [draft, setDraft] = useState("");
  const commit = (text: string): void => {
    const names = parseTagList(text);
    if (names.length === 0) return;
    onChange(mergeTags(value, names));
    setDraft("");
  };
  const remaining = (options ?? []).filter((option) => !value.includes(option.value));
  return (
    <div {...styling.props(styles.tagRow)} data-control="tags">
      <div {...styling.props(styles.chipsBox)}>
        {value.map((name) => (
          // 标签与里面的移除按钮是同一个整体：× 在框内，点它才移除。
          <span key={name} {...styling.props(styles.chip)} data-tag={name}>
            {name}
            <button
              type="button"
              {...styling.props(styles.chipRemove)}
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
          {...styling.props(styles.chipInput)}
          value={draft}
          placeholder={value.length === 0 ? placeholder : ""}
          aria-label={label}
          disabled={disabled}
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
      {remaining.length === 0 ? null : (
        <SelectMenu
          label={candidatesLabel}
          value=""
          emptyLabel={candidatesLabel}
          options={remaining}
          disabled={disabled}
          onSelect={(next) => {
            if (next !== "") commit(next);
          }}
        />
      )}
    </div>
  );
}
