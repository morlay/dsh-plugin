/**
 * 行内值的呈现与编辑文本规则，以及字段槽注册方复用的默认值组件。
 *
 * 值本身仍走草稿：这个文件只决定"怎么显示"（语法色 token、下拉触发的呈现）与"怎么编辑"（一行输入框里的文本
 * 形状——字符串把换行写成 `\n`，与一行的输入框相配）。
 */

import { useState, type ReactNode } from "react";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SelectOption } from "./hints.ts";
import type { SchemaFieldOwnerProps } from "./slot-contract.ts";
import { LineValue, ValueTrigger } from "./styles.ts";

/** 编辑态文本：字符串就是原文（换行照旧），其余按 JSON 写。 */
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** 这个值要在多行输入里编辑吗（字符串带换行）。 */
export function isMultiline(value: unknown): boolean {
  return typeof value === "string" && /[\r\n]/.test(value);
}

/** 显示态文本：字符串带引号；多行与特殊字符都按 JSON 的写法收在一行里。 */
export function tokenText(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** 值的语法色分组。 */
export function tokenTone(value: unknown): "string" | "number" | "boolean" | "empty" {
  if (value === undefined || value === null) return "empty";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

/**
 * 行内值的默认呈现（显示态 token）。
 * @param props.owner - 字段上下文（值、是否 secret、只读原因）。
 * @returns 一行里的值节点。
 */
export function InlineValue({ owner }: { owner: SchemaFieldOwnerProps }): ReactNode {
  if (owner.options !== undefined) return <OptionSelect owner={owner} options={owner.options} />;
  if (owner.node.meta.secret) {
    // secret 不回显值：截断时不给全文，只给说明。
    return (
      <LineValue data-tone="empty" title={owner.hint}>
        {owner.secretConfigured ? "••••••" : ""}
      </LineValue>
    );
  }
  return (
    <LineValue
      data-tone={owner.node.readOnly === null ? tokenTone(owner.value) : "empty"}
      // 值长了会截断：整份内容挂在 title 上，hover 就能看全。
      title={tokenText(owner.value)}
    >
      {tokenText(owner.value)}
    </LineValue>
  );
}

/**
 * 选择器：**值本身**就是下拉的触发（不再另画一个 `select` 与它并列），点开是官方菜单。
 *
 * 当前值不在候选里时（例如目录里已经没有那个服务商）照原样显示，选中才换成新值。
 */
function OptionSelect({
  owner,
  options,
}: {
  owner: SchemaFieldOwnerProps;
  options: readonly SelectOption[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const selected = options.findIndex((option) => sameValue(option.value, owner.value));
  const current = selected < 0 ? undefined : options[selected];
  const label =
    current?.label ??
    (owner.value === undefined
      ? owner.t("unconfigured")
      : tokenText(current?.value ?? owner.value));
  return (
    <Menu
      open={open}
      dense
      compact
      // 浮层挂到 body：行容器与表单壳的裁剪/层级都挡不住它。
      portal
      align="start"
      items={options.map((option, index) => ({
        id: String(index),
        label: option.label ?? tokenText(option.value),
      }))}
      selectedId={selected < 0 ? undefined : String(selected)}
      onSelect={(id) => {
        setOpen(false);
        const option = options[Number(id)];
        if (option !== undefined) owner.onChange(option.value);
      }}
      onClose={() => {
        setOpen(false);
      }}
      anchor={
        <ValueTrigger
          type="button"
          disabled={owner.disabled}
          aria-label={owner.label}
          onClick={() => {
            setOpen(true);
          }}
        >
          <LineValue
            data-tone={current === undefined ? tokenTone(owner.value) : tokenTone(current.value)}
          >
            {label}
          </LineValue>
        </ValueTrigger>
      }
    />
  );
}

/** 值是否就是这一项（菜单的高亮判据）。 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null)
    return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 字段槽注册方复用的默认值：只改文案时拿它包一层即可（`owner` 上覆盖 `label`/`hint`）。
 *
 * 注意行式视图里键名来自配置键本身、注释来自 `hint`，所以 `label` 只在业务自写控件时才需要。
 */
export function SchemaFieldDefault({ owner }: { owner: SchemaFieldOwnerProps }): ReactNode {
  return <InlineValue owner={owner} />;
}
