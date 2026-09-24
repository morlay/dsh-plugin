// @vitest-environment jsdom
/**
 * 行式编辑器的行为：行结构（行号 / `key: value` / 结构行 / 注释）、折叠、行内编辑（点开、提交、撤销）、
 * 容器尾部的添加行（敲键名或粘贴 JSON）、成员行的移除、以及字段槽的命中与兜底。
 *
 * 盯的接缝是**读数 → 行 → 动作**：一行画什么由字段树与草稿状态决定，一次交互只产生一个动作。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import z from "@deepseek-ai/schemastery";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addableAt,
  fieldKey,
  SchemaFormController,
  type SchemaFormActions,
  type SchemaFormFace,
  type SchemaFormState,
} from "../client/controller.ts";
import { zh } from "../client/locales.ts";
import { SchemaForm } from "../client/SchemaForm.tsx";
import { projectNode, walkFields, type FieldNode } from "../client/schema-node.ts";
import { fakeDescribe } from "../testing/fake-describe.ts";
import { FakeScope } from "../testing/fake-scope.ts";
import type {
  SchemaFieldOwnerProps,
  SchemaFormComponentProps,
  SchemaFormTranslate,
} from "../client/slot-contract.ts";

afterEach(cleanup);

const t = ((key: string) =>
  (zh as unknown as Record<string, string>)[key] ?? key) as unknown as SchemaFormTranslate;
const resolveText = (text: string | Readonly<Record<string, string>>): string =>
  typeof text === "string" ? text : (text["zh"] ?? text["en"] ?? "");

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

/** 一段配置的读数：字段树来自真 schema，值决定排出的行。 */
function bench(schema: z, value: unknown, overrides: Partial<SchemaFormState> = {}) {
  const root: FieldNode = projectNode(new z(schema.toJSON()));
  const walked = walkFields(root, value);
  const fields = new Map(
    walked.map((item) => [
      JSON.stringify(item.path),
      {
        value: pick(value, item.path),
        text: undefined,
        invalid: undefined,
        overridden: false,
        staged: false,
      },
    ]),
  );
  const state: SchemaFormState = {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    configured: true,
    root,
    walked,
    fields,
    secrets: new Map(),
    texts: new Map(),
    options: new Map(),
    invalidAt: new Map(),
    // 可添加项按控制器同一算法：值里没有的声明字段就是这一层的候选。
    addable: new Map(
      walked.flatMap((item) => {
        const candidates = addableAt(item.node, item.path, pick(value, item.path), undefined);
        return candidates.length === 0 ? [] : [[JSON.stringify(item.path), candidates] as const];
      }),
    ),
    violation: undefined,
    ...overrides,
  };
  const store = createSnapshotStore(state);
  const calls = actions();
  const face: SchemaFormFace = { hooks: { schemaForm: store }, ...calls };
  const claimed: SchemaFieldOwnerProps[] = [];
  const props = {
    ns: "row",
    face,
    t,
    resolveText,
    renderSlotChain: (
      _key: string,
      owner: SchemaFieldOwnerProps,
      opts?: { fallback?: unknown },
    ) => {
      claimed.push(owner);
      return opts?.fallback ?? null;
    },
  } as unknown as SchemaFormComponentProps;
  return { props, face, state, claimed, calls };
}

function pick(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => {
    if (Array.isArray(node)) return node[Number(key)];
    if (typeof node === "object" && node !== null) return (node as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

/** 一行的渲染文本（去掉行号列、折叠按钮、行为按钮与空白）。 */
function rowText(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-line]")].map((row) => {
    const body = row.querySelector('[data-role="body"]') ?? row;
    const clone = body.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll(
      '[data-role="fold"],[data-role="actions"],[data-role="number"],[data-role="variant"],[data-role="option"]',
    )) {
      el.remove();
    }
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

/** 一行字段的值节点（避开行号等文本）。 */
function valueOf(container: HTMLElement, path: string): HTMLElement {
  const row = container.querySelector(`[data-field-path="${path}"][data-line="field"]`);
  if (row === null) throw new Error(`no field row ${path}`);
  const value = row.querySelector("[data-tone]");
  if (value === null) throw new Error(`no value in ${path}`);
  return value as HTMLElement;
}

describe("行式编辑器", () => {
  it("按行画出对象：结构行 + `key: value` 行，行号连续", () => {
    const { props } = bench(z.object({ retry: z.number(), note: z.string() }), {
      retry: 3,
      note: "hi",
    });
    const { container } = render(<SchemaForm {...props} />);

    expect(rowText(container)).toEqual(["{", "retry: 3", 'note: "hi"', "}"]);
    expect(
      [...container.querySelectorAll("[data-line] > span:first-child")].map((el) => el.textContent),
    ).toEqual(["1", "2", "3", "4"]);
  });

  it("schema 的说明画成注释行（在字段行上方）", () => {
    // `description()` 的类型签名只写 string，meta 实际接受字典（与源码同一处放行）。
    const localized = { zh: "重试次数", en: "retries" } as unknown as string;
    const schema = z.object({ retry: z.number().description(localized) });
    const { props } = bench(schema, { retry: 1 });
    const { container } = render(<SchemaForm {...props} />);

    expect(rowText(container)).toEqual(["{", "// 重试次数", "retry: 1", "}"]);
  });

  it("数组画成 `[ ... ]`，每项一行（下标淡显）", () => {
    const { props } = bench(z.object({ tags: z.array(z.string()) }), { tags: ["x", "y"] });
    const { container } = render(<SchemaForm {...props} />);

    expect(rowText(container)).toEqual(["{", "tags: [", '0 "x"', '1 "y"', "]", "}"]);
  });

  it("折叠把子树收起来，再点一次展开", () => {
    const { props } = bench(z.object({ limits: z.object({ depth: z.number() }) }), {
      limits: { depth: 1 },
    });
    const { container } = render(<SchemaForm {...props} />);

    expect(rowText(container)).toEqual(["{", "limits: {", "depth: 1", "}", "}"]);

    fireEvent.click(screen.getAllByRole("button", { name: zh.toggleGroup })[1]!);

    expect(rowText(container)).toEqual(["{", "limits: {…}", "}"]);
  });

  it("值点开就能改：编辑态是行内输入，提交把原文交给草稿", () => {
    const { props, calls } = bench(z.object({ retry: z.number() }), { retry: 3 });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(valueOf(container, "retry"));
    const input = container.querySelector('[data-line="field"] input') as HTMLInputElement;
    expect(input.value).toBe("3");

    fireEvent.change(input, { target: { value: "12" } });
    expect(calls.setText).toHaveBeenCalledWith(["retry"], "12", expect.any(Function));
  });

  it("Esc 撤销这一行的草稿，输入框收起", () => {
    const { props, calls } = bench(z.object({ retry: z.number() }), { retry: 3 });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(valueOf(container, "retry"));
    fireEvent.keyDown(container.querySelector('[data-line="field"] input')!, { key: "Escape" });

    expect(calls.revert).toHaveBeenCalledWith(["retry"]);
    expect(container.querySelector('[data-line="field"] input')).toBeNull();
  });

  it("只读字段点不开（不可编辑）", () => {
    const { props } = bench(z.object({ kind: z.const("api") }), { kind: "api" });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(valueOf(container, "kind"));

    expect(container.querySelector('[data-line="field"] input')).toBeNull();
    expect(rowText(container)).toContain('kind: "api"');
  });

  it("对象的添加入口只列还没配的声明字段，选中即加成", () => {
    const { props, calls } = bench(z.object({ models: z.dict(z.string()), note: z.string() }), {
      models: {},
    });
    const { container } = render(<SchemaForm {...props} />);

    // 声明了、值里没有的字段不占行（它在候选里）。
    expect(rowText(container)).toEqual(["{", "models: {", "}", "}"]);
    fireEvent.focus(screen.getByPlaceholderText(zh.addProperty));
    fireEvent.click(screen.getByRole("menuitem", { name: "note" }));

    expect(calls.addKey).toHaveBeenCalledWith([], "note");
  });

  it("字典的添加输入：敲键名发 addKey，粘贴 JSON 整段赋值", () => {
    const { props, calls } = bench(z.object({ models: z.dict(z.string()) }), { models: {} });
    render(<SchemaForm {...props} />);

    const typed = screen.getByPlaceholderText(zh.addKey);
    fireEvent.change(typed, { target: { value: "chat" } });
    fireEvent.keyDown(typed, { key: "Enter" });
    expect(calls.addKey).toHaveBeenCalledWith(["models"], "chat");

    fireEvent.change(typed, { target: { value: '{"a":"b"}' } });
    fireEvent.keyDown(typed, { key: "Enter" });
    expect(calls.set).toHaveBeenCalledWith(["models"], { a: "b" });
  });

  it("数组的添加入口追加空项，粘贴 JSON 则整段赋值", () => {
    const { props, calls } = bench(z.object({ tags: z.array(z.string()) }), { tags: [] });
    render(<SchemaForm {...props} />);

    const add = screen.getByPlaceholderText(zh.addItemPaste);
    fireEvent.change(add, { target: { value: "x" } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(calls.appendItem).toHaveBeenCalledWith(["tags"]);

    fireEvent.change(add, { target: { value: '["a","b"]' } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(calls.set).toHaveBeenCalledWith(["tags"], ["a", "b"]);
  });

  it("成员行能移除：数组项按索引、字典键按键名", () => {
    const list = bench(z.object({ tags: z.array(z.string()) }), { tags: ["x"] });
    const first = render(<SchemaForm {...list.props} />);
    fireEvent.click(screen.getAllByRole("button", { name: zh.removeItem })[0]!);
    expect(list.calls.removeItem).toHaveBeenCalledWith(["tags"], 0);
    first.unmount();

    const map = bench(z.object({ models: z.dict(z.string()) }), { models: { chat: "m" } });
    render(<SchemaForm {...map.props} />);
    fireEvent.click(screen.getAllByRole("button", { name: zh.removeItem })[0]!);
    expect(map.calls.removeKey).toHaveBeenCalledWith(["models"], "chat");
  });

  it("非法草稿在行内给出消息", () => {
    const schema = z.object({ retry: z.number() });
    const root: FieldNode = projectNode(new z(schema.toJSON()));
    const walked = walkFields(root, { retry: 1 });
    const state: SchemaFormState = {
      available: true,
      writable: true,
      dirty: true,
      invalid: true,
      saving: false,
      failed: false,
      configured: true,
      root,
      walked,
      fields: new Map([
        [
          JSON.stringify([]),
          {
            value: { retry: "x" },
            text: undefined,
            invalid: undefined,
            overridden: false,
            staged: false,
          },
        ],
        [
          JSON.stringify(["retry"]),
          {
            value: 1,
            text: "x",
            invalid: zh.invalidNumber,
            overridden: true,
            staged: true,
          },
        ],
      ]),
      secrets: new Map(),
      texts: new Map(),
      options: new Map(),
      addable: new Map(),
      invalidAt: new Map(),
      violation: undefined,
    };
    const store = createSnapshotStore(state);
    const face: SchemaFormFace = {
      hooks: { schemaForm: store },
      ...actions(),
    } as unknown as SchemaFormFace;
    const props = {
      ns: "row",
      face,
      t,
      resolveText,
      renderSlotChain: (_k: string, _o: unknown, opts?: { fallback?: unknown }) =>
        opts?.fallback ?? null,
    } as unknown as SchemaFormComponentProps;
    const { container } = render(<SchemaForm {...props} />);

    // 消息占的是注释位（红字），不再挤在值后面。
    expect(screen.getByText(`// ${zh.invalidNumber}`)).toBeTruthy();
    expect(
      container
        .querySelector('[data-line="field"][data-field-path="retry"]')
        ?.getAttribute("data-invalid"),
    ).toBe("true");
  });

  it("字段槽命中时值位置换成注册方的节点", () => {
    const { props } = bench(z.object({ retry: z.number() }), { retry: 3 });
    const claimedProps = {
      ...props,
      renderSlotChain: (_key: string, owner: SchemaFieldOwnerProps) =>
        owner.path[0] === "retry" ? <span data-testid="claimed">自定义</span> : null,
    } as unknown as SchemaFormComponentProps;
    const { container } = render(<SchemaForm {...claimedProps} />);

    expect(screen.getByTestId("claimed")).toBeTruthy();
    expect(rowText(container)).toContain("retry: 自定义");
  });

  it("保存按钮只在脏的时候可点，点它走控制器的保存", () => {
    const clean = bench(z.object({ retry: z.number() }), { retry: 3 });
    const first = render(<SchemaForm {...clean.props} />);
    expect((screen.getByRole("button", { name: zh.save }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    first.unmount();

    const dirty = bench(z.object({ retry: z.number() }), { retry: 3 }, { dirty: true });
    render(<SchemaForm {...dirty.props} />);
    fireEvent.click(screen.getByRole("button", { name: zh.save }));
    expect(dirty.calls.save).toHaveBeenCalled();
  });

  it("行没有被描述出来时只给一行说明", () => {
    const { props } = bench(
      z.object({ retry: z.number() }),
      { retry: 3 },
      { configured: false, available: false },
    );
    render(<SchemaForm {...props} />);

    expect(screen.getByText(zh.noSchema)).toBeTruthy();
  });
});

describe("选择器与只读字段", () => {
  it("有候选的字段画成选择器，选中即写值", () => {
    const { props, calls } = bench(
      z.object({ journal: z.union(["wal", "delete"]) }),
      { journal: "wal" },
      {
        options: new Map([[JSON.stringify(["journal"]), [{ value: "wal" }, { value: "delete" }]]]),
      },
    );
    const { container } = render(<SchemaForm {...props} />);

    // 触发元素自己就是值：同一个值不画两遍；箭头是图标（不是文本字符）。
    expect(rowText(container)).toEqual(["{", 'journal: "wal"', "}"]);
    expect(screen.getByRole("button", { name: "journal" }).querySelector("svg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "journal" }));
    fireEvent.click(screen.getByRole("menuitem", { name: '"delete"' }));

    expect(calls.set).toHaveBeenCalledWith(["journal"], "delete");
  });

  it("disabled 字段（装配事实）画出值但点不开编辑，注释里标只读", () => {
    const schema = z.object({ cwd: z.string().default("/tmp").disabled().description("基准目录") });
    const { props } = bench(schema, { cwd: "/tmp" });
    const { container } = render(<SchemaForm {...props} />);

    expect(rowText(container)).toEqual(["{", "// 基准目录 · 只读", 'cwd: "/tmp"', "}"]);
    fireEvent.click(container.querySelector('[data-tone="string"]') as HTMLElement);
    expect(container.querySelector('[data-line="field"] input')).toBeNull();
  });
});

describe("union 与布局", () => {
  it("按当前值的形状画：数组是 `[ ... ]`，字符串是值行，行尾给形状切换", () => {
    const schema = z.object({ access: z.union([z.array(z.string()), z.string()]) });
    const asList = bench(schema, { access: ["rw:/tmp"] });
    const first = render(<SchemaForm {...asList.props} />);
    expect(rowText(first.container)).toEqual(["{", "access: [", '0 "rw:/tmp"', "]", "}"]);
    expect(screen.getByRole("button", { name: zh.switchVariant })).toBeTruthy();
    first.unmount();

    const asText = bench(schema, { access: "rw:/tmp" });
    const second = render(<SchemaForm {...asText.props} />);
    expect(rowText(second.container)).toEqual(["{", 'access: "rw:/tmp"', "}"]);
  });

  it("切换形状：把目标变体的值交给草稿", () => {
    const { props, calls } = bench(
      z.object({ access: z.union([z.array(z.string()), z.string()]) }),
      {
        access: "rw:/tmp",
      },
    );
    render(<SchemaForm {...props} />);

    fireEvent.click(screen.getByRole("button", { name: zh.switchVariant }));
    fireEvent.click(screen.getByRole("menuitem", { name: "[ ]" }));

    expect(calls.set).toHaveBeenCalledWith(["access"], []);
  });

  it("判别式 union 的切换画在标签行上，选中即写标签值", () => {
    const schema = z.union([
      z.object({ type: z.const("sqlite"), path: z.string() }),
      z.object({ type: z.const("postgres"), connectionString: z.string() }),
    ]);
    const { props, calls } = bench(schema, { type: "sqlite", path: "/tmp/a.db" });
    const { container } = render(<SchemaForm {...props} />);

    // 值是 const：页面上只出现一份，就是那个切换触发（不再「值 + 触发」两遍）。
    expect(rowText(container)).toEqual(["{", "type:", 'path: "/tmp/a.db"', "}"]);
    expect(container.querySelectorAll('[data-role="variant"]')).toHaveLength(1);
    expect(container.textContent?.match(/"sqlite"/g)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: zh.switchVariant }));
    fireEvent.click(screen.getByRole("menuitem", { name: '"postgres"' }));

    expect(calls.set).toHaveBeenCalledWith(["type"], "postgres");
  });

  it("缩进只推行内容：行号列固定，添加输入与闭合括号同一行", () => {
    const { props } = bench(z.object({ limits: z.object({ depth: z.number() }) }), {
      limits: { depth: 1 },
    });
    const { container } = render(<SchemaForm {...props} />);

    const rows = [...container.querySelectorAll("[data-line]")];
    // 每一行的第一个子节点都是行号列（缩进不推它）。
    for (const row of rows) {
      expect(row.children[0]?.getAttribute("data-role")).toBe("number");
    }
    /** 一行的内容区缩进（行号列不在里面）。 */
    const indentOf = (row: Element | undefined): string =>
      (row?.querySelector('[data-role="body"]') as HTMLElement | null)?.style.paddingLeft ?? "";
    // 第一层就缩进一格，第二层再一格；根的 `{` 不缩进。
    expect(indentOf(rows.find((row) => row.getAttribute("data-field-path") === "limits"))).toBe(
      "14px",
    );
    expect(
      indentOf(rows.find((row) => row.getAttribute("data-field-path") === "limits.depth")),
    ).toBe("28px");
    expect(indentOf(rows[0])).toBe("0px");
    // 闭合行自带添加入口（不是另起一行）；对象的声明字段都配齐时不给输入框。
    const rootClose = (scope: HTMLElement): HTMLElement =>
      scope.querySelector('[data-line="close"][data-field-path=""]') as HTMLElement;
    expect(rootClose(container).querySelector("input")).toBeNull();

    const withGap = bench(z.object({ limits: z.object({ depth: z.number() }), note: z.string() }), {
      limits: { depth: 1 },
    });
    const second = render(<SchemaForm {...withGap.props} />);
    expect(rootClose(second.container).querySelector("input")).toBeTruthy();
  });

  it("带换行的值点开是多行输入：Enter 不提交，原文进草稿", () => {
    const { props, calls } = bench(z.object({ note: z.string() }), { note: "a\nb" });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(valueOf(container, "note"));
    const area = container.querySelector('[data-line="field"] textarea') as HTMLTextAreaElement;
    expect(area.value).toBe("a\nb");

    fireEvent.change(area, { target: { value: "a\nb\nc" } });
    expect(calls.setText).toHaveBeenCalledWith(["note"], "a\nb\nc", expect.any(Function));
  });

  it("有覆盖的字段：注释里不写「已覆盖」，行尾给「恢复默认」，点它发 clear", () => {
    const { props, calls } = bench(
      z.object({ retry: z.number() }),
      { retry: 3 },
      {
        fields: new Map([
          [
            JSON.stringify(["retry"]),
            {
              value: 3,
              text: undefined,
              invalid: undefined,
              overridden: true,
              staged: false,
            },
          ],
        ]),
      },
    );
    const { container } = render(<SchemaForm {...props} />);

    expect(container.textContent).not.toContain("已覆盖");
    fireEvent.click(screen.getByRole("button", { name: zh.reset }));

    expect(calls.clear).toHaveBeenCalledWith(["retry"]);
  });

  it("没有覆盖的字段不给「恢复默认」", () => {
    const { props } = bench(z.object({ retry: z.number() }), { retry: 3 });
    render(<SchemaForm {...props} />);

    expect(screen.queryByRole("button", { name: zh.reset })).toBeNull();
  });

  it("复制这一行的值：字符串带引号进剪贴板", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { props } = bench(z.object({ note: z.string() }), { note: "hi" });
    render(<SchemaForm {...props} />);

    fireEvent.click(screen.getByRole("button", { name: zh.copyValue }));

    expect(writeText).toHaveBeenCalledWith('"hi"');
  });

  it("点行号选中这一行", () => {
    const { props } = bench(z.object({ retry: z.number() }), { retry: 3 });
    const { container } = render(<SchemaForm {...props} />);
    const row = container.querySelector('[data-field-path="retry"]') as HTMLElement;

    expect(row.getAttribute("data-selected")).toBeNull();
    fireEvent.click(container.querySelector('[data-field-path="retry"] [data-role="number"]')!);

    expect(row.getAttribute("data-selected")).toBe("true");
  });

  it("不可写时：添加入口不给，写动作按钮禁用", () => {
    const { props } = bench(
      z.object({ tags: z.array(z.string()) }),
      { tags: ["x"] },
      { writable: false },
    );
    const { container } = render(<SchemaForm {...props} />);

    expect(container.querySelector('[data-line="close"] input')).toBeNull();
    expect(
      (screen.getByRole("button", { name: zh.removeItem }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("添加入口的候选跟着输入过滤", () => {
    const { props } = bench(
      z.object({ models: z.dict(z.string()), note: z.string(), name: z.string() }),
      { models: {} },
    );
    render(<SchemaForm {...props} />);

    const add = screen.getByPlaceholderText(zh.addProperty);
    fireEvent.focus(add);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "note",
      "name",
    ]);

    fireEvent.change(add, { target: { value: "na" } });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["name"]);
  });

  it("编辑态只显示输入框：原值不再在它旁边画一遍", () => {
    const { props } = bench(z.object({ retry: z.number() }), { retry: 3 });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(valueOf(container, "retry"));

    expect(container.querySelectorAll("[data-tone]")).toHaveLength(0);
  });

  it("本页改过的字段：行上有高亮，hover 里是「撤回」，点它退回去", () => {
    const { props, calls } = bench(
      z.object({ retry: z.number() }),
      { retry: 3 },
      {
        fields: new Map([
          [
            JSON.stringify(["retry"]),
            { value: 4, text: undefined, invalid: undefined, overridden: true, staged: true },
          ],
        ]),
      },
    );
    const { container } = render(<SchemaForm {...props} />);

    const row = container.querySelector(
      '[data-line="field"][data-field-path="retry"]',
    ) as HTMLElement;
    expect(row.getAttribute("data-dirty")).toBe("true");
    expect(row.getAttribute("data-overridden")).toBeNull();
    // 改过的字段名带标记：样式据此上强调色。
    expect(row.querySelector('[data-role="key"]')?.textContent).toBe("retry");
    fireEvent.click(screen.getByRole("button", { name: zh.revert }));

    expect(calls.revert).toHaveBeenCalledWith(["retry"]);
  });

  it("已存进用户层（没有本页草稿）的字段：另一种高亮，给的是「恢复默认」", () => {
    const { props } = bench(
      z.object({ retry: z.number() }),
      { retry: 3 },
      {
        fields: new Map([
          [
            JSON.stringify(["retry"]),
            { value: 3, text: undefined, invalid: undefined, overridden: true, staged: false },
          ],
        ]),
      },
    );
    const { container } = render(<SchemaForm {...props} />);

    const row = container.querySelector('[data-field-path="retry"]') as HTMLElement;
    expect(row.getAttribute("data-overridden")).toBe("true");
    expect(row.getAttribute("data-dirty")).toBeNull();
    expect(screen.getByRole("button", { name: zh.reset })).toBeTruthy();
  });

  it("必填字段没值时也占一行，而且直接是一个等着输入的位子", () => {
    const { props, calls } = bench(z.object({ host: z.string().required() }), {});
    const { container } = render(<SchemaForm {...props} />);

    expect(rowText(container)).toEqual(["{", "host:", "}"]);
    const input = container.querySelector('[data-line="field"] input') as HTMLInputElement;
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "example.com" } });
    expect(calls.setText).toHaveBeenCalledWith(["host"], "example.com", expect.any(Function));
  });
});

/**
 * 真控制器 + 真渲染：编辑器那边的替身 face 断不出「加成之后行没出现」这类问题，所以这里两侧都用真的。
 */
describe("与真控制器一起跑", () => {
  function live(
    schema: z,
    value: unknown,
    validate: (
      value: Record<string, unknown>,
    ) => { message: string; path: readonly string[] } | undefined = () => undefined,
  ) {
    const describeFace = fakeDescribe([
      {
        ns: "row",
        schema: schema.toJSON(),
        value: {},
        autoGenerate: true,
        applies: "live",
        secrets: [],
        revision: 1,
      } as never,
    ]);
    const scope = new FakeScope({ value: value as never });
    const controller = new SchemaFormController("row", {
      form: scope,
      describe: describeFace,
      rehydrate: (serialized) => new z(serialized as never) as never,
      t,
      validate: (_schema, section) => validate(section as Record<string, unknown>),
    });
    const state = () => controller.face().hooks.schemaForm.getSnapshot();
    const props = {
      ns: "row",
      face: controller.face(),
      t,
      resolveText,
      renderSlotChain: (
        _key: string,
        _owner: SchemaFieldOwnerProps,
        opts?: { fallback?: unknown },
      ) => opts?.fallback ?? null,
    } as unknown as SchemaFormComponentProps;
    return { state, props, scope };
  }

  it("从候选加成：新行出现，而且直接是一个能打字的输入位", () => {
    const { state, props } = live(z.object({ host: z.string().required(), note: z.string() }), {
      host: "h",
    });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.focus(screen.getByPlaceholderText(zh.addProperty));
    fireEvent.click(screen.getByRole("menuitem", { name: "note" }));

    expect(state().walked.map((item) => item.path.join("."))).toContain("note");
    const input = container.querySelector('[data-field-path="note"] input') as HTMLInputElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: "hi" } });
    expect(state().fields.get(fieldKey(["note"]))?.value).toBe("hi");
    // 加进来之后它就不再是候选了。
    expect(state().addable.get(fieldKey([]))).toBeUndefined();
  });

  it("数组追加：新项出现且是输入位", () => {
    const { state, props } = live(z.object({ tags: z.array(z.string()) }), { tags: [] });
    const { container } = render(<SchemaForm {...props} />);

    const add = screen.getByPlaceholderText(zh.addItemPaste);
    fireEvent.change(add, { target: { value: "x" } });
    fireEvent.keyDown(add, { key: "Enter" });

    expect(state().walked.map((item) => item.path.join("."))).toContain("tags.0");
    expect(container.querySelector('[data-field-path="tags.0"] input')).toBeTruthy();
  });

  it("对象层敲了没声明的键名：不写，并说清这一层没有这个字段", () => {
    const { props, calls } = bench(z.object({ host: z.string().required(), note: z.string() }), {
      host: "h",
    });
    render(<SchemaForm {...props} />);

    const add = screen.getByPlaceholderText(zh.addProperty);
    fireEvent.change(add, { target: { value: "scheme" } });
    fireEvent.keyDown(add, { key: "Enter" });

    expect(calls.addKey).not.toHaveBeenCalled();
    expect(screen.getByText(zh.unknownProperty)).toBeTruthy();

    // 敲对了就加成，消息消失。
    fireEvent.change(add, { target: { value: "note" } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(calls.addKey).toHaveBeenCalledWith([], "note");
    expect(screen.queryByText(zh.unknownProperty)).toBeNull();
  });

  it("编辑态的确认与取消：确认收起（草稿留着），取消退回原值", () => {
    const { props, calls } = bench(z.object({ retry: z.number() }), { retry: 3 });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(valueOf(container, "retry"));
    const confirm = screen.getByRole("button", { name: zh.confirmEdit });
    // 图标要真的画出来（行底色上一个没有图形的按钮等于不存在）。
    expect(confirm.querySelector("svg")).toBeTruthy();
    expect(confirm.closest('[data-role="actions"]')?.getAttribute("data-editing")).toBe("true");
    fireEvent.click(confirm);
    expect(container.querySelector('[data-line="field"] input')).toBeNull();
    expect(calls.revert).not.toHaveBeenCalled();

    fireEvent.click(valueOf(container, "retry"));
    fireEvent.click(screen.getByRole("button", { name: zh.cancelEdit }));
    expect(calls.revert).toHaveBeenCalledWith(["retry"]);
    expect(container.querySelector('[data-line="field"] input')).toBeNull();
  });

  it("判别式 union：切到另一支后，标签行的那个触发显示新的一支", () => {
    const { state, props } = live(
      z.union([
        z.object({ type: z.const("sqlite"), path: z.string().required() }),
        z.object({ type: z.const("postgres"), connectionString: z.string().required() }),
      ]),
      { type: "sqlite", path: "/tmp/a.db" },
    );
    const { container } = render(<SchemaForm {...props} />);

    const trigger = (): HTMLElement =>
      container.querySelector('[data-field-path="type"] [data-role="variant"]') as HTMLElement;
    expect(trigger().textContent).toBe('"sqlite"');

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: '"postgres"' }));

    expect(state().fields.get(fieldKey(["type"]))?.value).toBe("postgres");
    // 触发跟着草稿走（容器的读数与字段树必须是同一份）。
    expect(trigger().textContent).toBe('"postgres"');
    expect(container.querySelector('[data-field-path="connectionString"]')).toBeTruthy();
  });

  it("还没值的必填格子：取消先收起输入框，点值又能进来接着填", () => {
    const { props } = live(z.object({ host: z.string().required() }), {});
    const { container } = render(<SchemaForm {...props} />);
    const row = (): HTMLElement =>
      container.querySelector('[data-field-path="host"]') as HTMLElement;

    expect(row().querySelector("input")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: zh.cancelEdit }));

    expect(row().querySelector("input")).toBeNull();
    fireEvent.click(row().querySelector("[data-tone]") as HTMLElement);

    expect(row().querySelector("input")).toBeTruthy();
  });

  it("加成还没保存的那一项：取消后整项退回候选", () => {
    const { state, props } = live(z.object({ host: z.string().required(), note: z.string() }), {
      host: "h",
    });
    const { container } = render(<SchemaForm {...props} />);
    fireEvent.focus(screen.getByPlaceholderText(zh.addProperty));
    fireEvent.click(screen.getByRole("menuitem", { name: "note" }));
    expect(container.querySelector('[data-field-path="note"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: zh.cancelEdit }));

    expect(container.querySelector('[data-field-path="note"]')).toBeNull();
    expect(
      state()
        .addable.get(fieldKey([]))
        ?.map((option) => option.key),
    ).toEqual(["note"]);
  });

  it("点候选时输入框的失焦不该吞掉这次点击", () => {
    const { props, calls } = bench(z.object({ host: z.string().required(), note: z.string() }), {
      host: "h",
    });
    render(<SchemaForm {...props} />);

    const add = screen.getByPlaceholderText(zh.addProperty);
    fireEvent.focus(add);
    // 真实浏览器里 pointerdown 先让输入框失焦；菜单若在这时收起，click 就没有落点了。
    fireEvent.blur(add);
    fireEvent.click(screen.getByRole("menuitem", { name: "note" }));

    expect(calls.addKey).toHaveBeenCalledWith([], "note");
  });

  it("截断的地方 hover 出全文：注释与值都挂 title", () => {
    const localized = { zh: "很长的一段说明", en: "long" } as unknown as string;
    const schema = z.object({ note: z.string().description(localized) });
    const { props } = bench(schema, { note: "一个很长的值" });
    const { container } = render(<SchemaForm {...props} />);

    const comment = container.querySelector('[data-line="comment"] [title]') as HTMLElement;
    expect(comment.getAttribute("title")).toBe("很长的一段说明");
    const value = container.querySelector('[data-tone="string"]') as HTMLElement;
    expect(value.getAttribute("title")).toBe('"一个很长的值"');
  });

  it("行内编辑按 schema 的类型解析：number 存下去是数字，不是字符串", () => {
    const { state, props } = live(z.object({ busyTimeout: z.natural().default(5000) }), {
      busyTimeout: 5000,
    });
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(
      container.querySelector('[data-field-path="busyTimeout"] [data-tone]') as HTMLElement,
    );
    const input = container.querySelector(
      '[data-field-path="busyTimeout"] input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3000" } });

    expect(state().fields.get(fieldKey(["busyTimeout"]))?.value).toBe(3000);
  });

  it("整段校验挡下的保存：不发写，并在页面上说清楚", async () => {
    const { state, props, scope } = live(
      z.object({ busyTimeout: z.number().default(5000) }),
      { busyTimeout: 5000 },
      (section) =>
        section["busyTimeout"] === 2000
          ? undefined
          : { message: "busyTimeout 只接受 2000", path: ["busyTimeout"] },
    );
    const { container } = render(<SchemaForm {...props} />);

    fireEvent.click(
      container.querySelector('[data-field-path="busyTimeout"] [data-tone]') as HTMLElement,
    );
    const input = container.querySelector(
      '[data-field-path="busyTimeout"] input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: zh.save }));
    await Promise.resolve();
    await Promise.resolve();

    expect(scope.writes).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("没有保存");
    expect(state().violation?.message).toContain("只接受 2000");
    // 消息落在出错的那一行上，而不是只在底部。
    expect(state().invalidAt.get(fieldKey(["busyTimeout"]))).toContain("只接受 2000");
    expect(
      container.querySelector('[data-field-path="busyTimeout"] [data-role="body"]')?.textContent,
    ).toContain("只接受 2000");
  });

  it("成员的值本身是容器时也能移除（字典键删掉一整项、数组项同理）", () => {
    const map = bench(z.object({ models: z.dict(z.object({ provider: z.string() })) }), {
      models: { chat: { provider: "m" } },
    });
    const first = render(<SchemaForm {...map.props} />);
    // 那一项开在 `chat: {` 这一行上：移除按钮必须跟着它，而不是只挂在叶子字段行。
    fireEvent.click(screen.getAllByRole("button", { name: zh.removeItem })[0]!);
    expect(map.calls.removeKey).toHaveBeenCalledWith(["models"], "chat");
    first.unmount();

    const list = bench(z.object({ items: z.array(z.object({ id: z.string() })) }), {
      items: [{ id: "a" }],
    });
    render(<SchemaForm {...list.props} />);
    fireEvent.click(screen.getAllByRole("button", { name: zh.removeItem })[0]!);
    expect(list.calls.removeItem).toHaveBeenCalledWith(["items"], 0);
  });

  it("移除字典的一整项：值从读数里消失，退回可添加项", () => {
    const { state, props, scope } = live(
      z.object({ models: z.dict(z.object({ provider: z.string() })) }),
      { models: { chat: { provider: "m" } } },
    );
    render(<SchemaForm {...props} />);

    fireEvent.click(screen.getByRole("button", { name: zh.removeItem }));

    expect(state().walked.map((item) => item.path.join("."))).not.toContain("models.chat");
    expect(scope.writes).toEqual([]);
  });
});
