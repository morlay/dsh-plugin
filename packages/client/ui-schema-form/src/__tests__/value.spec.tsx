// @vitest-environment jsdom
/**
 * 行内值与文本解析：显示态是语法色的 token，编辑态的文本按字段类型解析。
 *
 * 盯的接缝是**值 → 显示 / 文本 → 值**：字符串带引号显示但编辑的是原文；secret 不回显值；数字、布尔、JSON 各有
 * 自己的解析规则与失败消息。
 */

import { cleanup, render, screen } from "@testing-library/react";
import z from "@deepseek-ai/schemastery";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchemaFormActions } from "../client/controller.ts";
import { parseFor } from "../client/fields.tsx";
import { isMultiline } from "../client/value.tsx";
import { zh } from "../client/locales.ts";
import { projectNode, type FieldNode } from "../client/schema-node.ts";
import type { SchemaFieldOwnerProps, SchemaFormTranslate } from "../client/slot-contract.ts";
import {
  InlineValue,
  SchemaFieldDefault,
  tokenText,
  tokenTone,
  valueText,
} from "../client/value.tsx";

afterEach(cleanup);

const t = ((key: string, params?: Record<string, unknown>) => {
  const template = (zh as unknown as Record<string, string>)[key] ?? key;
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match, name: string) => {
        const value = params[name];
        return typeof value === "string" || typeof value === "number" ? String(value) : "";
      });
}) as unknown as SchemaFormTranslate;

function actions(): SchemaFormActions {
  return {
    set: vi.fn(),
    setText: vi.fn(),
    clear: vi.fn(),
    appendItem: vi.fn(),
    removeItem: vi.fn(),
    addKey: vi.fn(),
    removeKey: vi.fn(),
    revert: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  };
}

/** 一个字段的 owner：节点来自真 schema 的投影。 */
function ownerOf(
  schema: z,
  path: readonly string[] = ["field"],
  overrides: Partial<SchemaFieldOwnerProps> = {},
) {
  const node = projectNode(new z(schema.toJSON()), path);
  const props: SchemaFieldOwnerProps = {
    ns: "row",
    path,
    node,
    label: node.key,
    hint: undefined,
    value: undefined,
    options: undefined,
    text: undefined,
    secretConfigured: false,
    depth: 0,
    overridden: false,
    invalid: undefined,
    disabled: false,
    t,
    actions: actions(),
    group: undefined,
    member: undefined,
    onChange: vi.fn(),
    onEditText: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  return props;
}

describe("行内值", () => {
  it("字符串带引号显示，编辑态文本是不带引号的原文", () => {
    const owner = ownerOf(z.string(), ["field"], { value: "hello" });
    render(<InlineValue owner={owner} />);

    expect(screen.getByText('"hello"')).toBeTruthy();
    expect(valueText("hello")).toBe("hello");
    expect(tokenText("hello")).toBe('"hello"');
  });

  it("数字与布尔各有语法色分组，空值显示 null", () => {
    expect(tokenTone(1)).toBe("number");
    expect(tokenTone(true)).toBe("boolean");
    expect(tokenTone("s")).toBe("string");
    expect(tokenTone(undefined)).toBe("empty");
    expect(tokenText(undefined)).toBe("null");
  });

  it("secret 不回显值：只显示已配置与否", () => {
    const configured = ownerOf(z.string().role("secret"), ["field"], { secretConfigured: true });
    render(<InlineValue owner={configured} />);
    expect(screen.getByText("••••••")).toBeTruthy();

    cleanup();
    const blank = ownerOf(z.string().role("secret"), ["field"], { secretConfigured: false });
    render(<InlineValue owner={blank} />);
    expect(screen.queryByText("••••••")).toBeNull();
  });

  it("带换行的字符串原样进编辑、原样出草稿（多行输入里编辑）", () => {
    expect(valueText("a\nb")).toBe("a\nb");
    expect(isMultiline("a\nb")).toBe(true);
    expect(isMultiline("a")).toBe(false);
    expect(parseFor(projectNode(new z(z.string().toJSON())), t)("a\nb")).toEqual({
      kind: "value",
      value: "a\nb",
    });
  });

  it("字段槽复用的默认值就是行内值", () => {
    const owner = ownerOf(z.number(), ["field"], { value: 3 });
    const { container } = render(<SchemaFieldDefault owner={owner} />);

    expect(container.textContent).toBe("3");
  });
});

describe("文本解析规则", () => {
  it("number：空与非法都挡保存，step=1 只收整数", () => {
    const parse = parseFor(projectNode(new z(z.number().step(1).toJSON())), t);

    expect(parse("2")).toEqual({ kind: "value", value: 2 });
    expect(parse("2.5")).toEqual({ kind: "invalid", message: zh.invalidInteger });
    expect(parse("abc")).toEqual({ kind: "invalid", message: zh.invalidNumber });
    expect(parse("")).toEqual({ kind: "invalid", message: zh.invalidNumber });
  });

  it("boolean：只收 true / false", () => {
    const parse = parseFor(projectNode(new z(z.boolean().toJSON())), t);

    expect(parse("true")).toEqual({ kind: "value", value: true });
    expect(parse("false")).toEqual({ kind: "value", value: false });
    expect(parse("yes")).toEqual({ kind: "invalid", message: zh.invalidBoolean });
  });

  it("any：合法 JSON 给值，非法 JSON 挡保存", () => {
    const parse = parseFor(projectNode(new z(z.any().toJSON())), t);

    expect(parse('{"a":1}')).toEqual({ kind: "value", value: { a: 1 } });
    expect(parse("{")).toEqual({ kind: "invalid", message: zh.invalidJson });
  });

  it("string：原文即值", () => {
    const parse = parseFor(projectNode(new z(z.string().toJSON())), t);

    expect(parse(" hi ")).toEqual({ kind: "value", value: " hi " });
  });
});

void ({} as FieldNode);

describe("声明了界限的字段", () => {
  it("min / max / pattern / 字面量集合都当场说话", () => {
    const ranged = parseFor(projectNode(new z(z.number().min(1).max(9).toJSON())), t);
    expect(ranged("5")).toEqual({ kind: "value", value: 5 });
    expect(ranged("0")).toEqual({
      kind: "invalid",
      message: zh.invalidRange.replace("{min}", "1").replace("{max}", "9"),
    });
    expect(ranged("99")).toMatchObject({ kind: "invalid" });

    const lowerOnly = parseFor(projectNode(new z(z.number().min(1).toJSON())), t);
    expect(lowerOnly("0")).toEqual({
      kind: "invalid",
      message: zh.invalidMin.replace("{min}", "1"),
    });

    const patterned = parseFor(projectNode(new z(z.string().pattern(/^sk-/).toJSON())), t);
    expect(patterned("sk-abc")).toEqual({ kind: "value", value: "sk-abc" });
    expect(patterned("abc")).toMatchObject({ kind: "invalid" });

    const enumerated = parseFor(projectNode(new z(z.union(["wal", "delete"]).toJSON())), t);
    expect(enumerated("wal")).toEqual({ kind: "value", value: "wal" });
    expect(enumerated("nope")).toEqual({
      kind: "invalid",
      message: zh.invalidChoice.replace("{choices}", "wal / delete"),
    });
  });
});
