// @vitest-environment jsdom
// bundle 配置页的布局与交互：模式卡片默认收起、点开才出现字段；`noop` 没有删除入口；编辑与增删都只上报动作
// （真正的写盘归保存）。

import { useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import z from "@deepseek-ai/schemastery";
import { afterEach, describe, expect, it, vi } from "vitest";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import { BundleConfigPage, type BundleConfigPageProps } from "../client/BundleConfigPage.tsx";
import { styles } from "../client/BundleConfigPage.styles.ts";
import { createBundleConfigFace, type BundleTranslate } from "../client/bundle-config.ts";
import { bundleZh } from "../client/bundle-locales.ts";
import { Config } from "../modes.ts";

afterEach(cleanup);

// 页面字典：真文案（断言里按文案找控件）。
const t = ((key: keyof typeof bundleZh, args?: Record<string, unknown>) => {
  const template = bundleZh[key];
  return args === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(args[name]));
}) as BundleTranslate;

// 一段真实的 config 值：编码模式 + "什么都不加"的 `noop`。
const section = {
  default: "coding",
  modes: {
    coding: {
      name: "编码模式",
      description: "编码",
      role: ["main", "subagent"],
      persona: { prefix: "你是编程专家", suffix: "" },
      allowTools: [],
      denyTools: ["load_workspace_dependencies"],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: true,
      runtimeContext: true,
    },
    noop: {
      name: "原样模式",
      description: "与上游一致",
      role: ["main", "subagent"],
      persona: { prefix: "", suffix: "" },
      allowTools: [],
      denyTools: [],
      allowSkills: [],
      denySkills: [],
      allowPolicies: [],
      denyPolicies: [],
      instructions: true,
      runtimeContext: true,
    },
  },
  models: {},
};

// 挂上页面：真控制器（草稿 / 校验 / 保存都是它）＋ 记下动作调用的包装。
function mounted() {
  const form = volatileForm(Config as never) as z;
  const snapshot = {
    status: "ready",
    value: section,
    base: {},
    user: undefined,
    writable: true,
    revision: 1,
    mode: "host",
  };
  const { face, dispose } = createBundleConfigFace(
    {
      configForms: {
        get: () => ({
          getSnapshot: () => snapshot,
          subscribe: () => () => {},
          mutate: () => Promise.resolve(true),
          set: () => Promise.resolve(true),
          unset: () => Promise.resolve(true),
        }),
        describe: () => ({
          getSnapshot: () => ({
            status: "ready",
            view: {
              namespaces: [
                {
                  ns: "session-mode",
                  schema: form.toJSON(),
                  value: section,
                  autoGenerate: true,
                  applies: "live",
                  secrets: [],
                  revision: 1,
                },
              ],
              writable: true,
              hasDocument: false,
            },
            error: null,
          }),
          subscribe: () => () => {},
          ensure: () => Promise.resolve(),
          acceptView: () => {},
        }),
      },
      settingsSchema: { rehydrate: (serialized: unknown) => new z(serialized as never) },
      locale: { bind: () => t },
      get: () => undefined,
    } as never,
    t,
  );
  const edits: { text: string; path: readonly string[] }[] = [];
  const sets: { path: readonly string[]; value: unknown }[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const saved = vi.fn();
  const wrapped = {
    ...face,
    editText: (path: readonly string[], text: string) => {
      edits.push({ path, text });
      face.editText(path, text);
    },
    set: (path: readonly string[], value: unknown) => {
      sets.push({ path, value });
      face.set(path, value);
    },
    addMode: (id: string) => {
      added.push(id);
      face.addMode(id);
    },
    removeMode: (id: string) => {
      removed.push(id);
      face.removeMode(id);
    },
    save: () => {
      saved();
      face.save();
    },
  };
  return { wrapped, dispose, edits, sets, added, removed, saved };
}

function renderPage(): ReturnType<typeof mounted> {
  const mountedPage = mounted();
  const props = {
    view: "page",
    t,
    // 框架那个 hook 是 uSES：替身也走订阅，草稿一变页面就重渲染（否则标签列表停在旧值）。
    useBundleConfig: (selector: (state: unknown) => unknown) =>
      useSyncExternalStore(
        (listener: () => void) => mountedPage.wrapped.hooks.bundleConfig.subscribe(listener),
        () => selector(mountedPage.wrapped.hooks.bundleConfig.getSnapshot()),
      ),
    useBundleStatus: (selector: (status: unknown) => unknown) =>
      useSyncExternalStore(
        (listener: () => void) => mountedPage.wrapped.hooks.bundleStatus.subscribe(listener),
        () => selector(mountedPage.wrapped.hooks.bundleStatus.getSnapshot()),
      ),
    ...mountedPage.wrapped,
  } as unknown as BundleConfigPageProps;
  render(<BundleConfigPage {...props} />);
  return mountedPage;
}

// 一张模式卡片的元素（按 `data-mode` 找）。
function card(id: string): HTMLElement {
  const element = document.querySelector(`[data-mode="${id}"]`);
  if (element === null) throw new Error(`没有 ${id} 这张卡片`);
  return element as HTMLElement;
}

describe("会话模式的 bundle 配置页", () => {
  it("模式卡片默认收起：字段不占页面，卡片头是名称与摘要", () => {
    renderPage();

    const coding = card("coding");
    expect(within(coding).getByText("编码模式")).toBeTruthy();
    expect(within(coding).queryByText(bundleZh["field.allowTools"])).toBeNull();
    expect(coding.getAttribute("data-deletable")).toBe("true");
  });

  it("点开一张卡片：字段按分组出现（默认模式另有一处选择）", () => {
    renderPage();

    const defaultSection = document.querySelector('[data-section="default"]') as HTMLElement;
    expect(within(defaultSection).getAllByText(bundleZh["default.label"]).length).toBeGreaterThan(
      0,
    );
    // 默认模式那一行是左右布局：标签与说明在左，选择器在最右。
    expect(defaultSection.querySelector('[data-action="pick"]')).toBeTruthy();
    fireEvent.click(within(card("coding")).getByText("编码模式"));

    expect(within(card("coding")).getByText(bundleZh["group.tools"])).toBeTruthy();
    expect(within(card("coding")).getByText(bundleZh["field.allowTools"])).toBeTruthy();
    const name = document.querySelector('[data-field="modes.coding.name"] input');
    expect(name).not.toBeNull();
    expect((name as HTMLInputElement).value).toBe("编码模式");
  });

  it("字段排法与通用设置一致：标签 / 控件 / 说明同列，字段之间一条细分隔线", () => {
    renderPage();

    fireEvent.click(within(card("coding")).getByText("编码模式"));
    const tools = document.querySelector('[data-field="modes.coding.denyTools"]') as HTMLElement;
    const text = tools.textContent ?? "";
    expect(text).toContain(bundleZh["field.denyTools"]);
    expect(text).toContain(bundleZh["hint.denyTools"]);
    // 说明在标签之后（同一列里的先后顺序）。
    expect(text.indexOf(bundleZh["hint.denyTools"])).toBeGreaterThan(
      text.indexOf(bundleZh["field.denyTools"]),
    );

    // 分隔线：这一组的第一个字段没有，其余有（与官方设置面的 `.field + .field` 同一种口径）。
    const fields = [
      ...document.querySelectorAll('[data-group="tools"] [data-field]'),
    ] as HTMLElement[];
    expect(fields.map((field) => field.getAttribute("data-divider"))).toEqual([
      "false",
      "true",
      "true",
      "true",
    ]);
  });

  it("开关 / 三态 / 多选按钮右置：标签与说明在左，控件贴最右", () => {
    const page = renderPage();
    fireEvent.click(within(card("coding")).getByText("编码模式"));

    // 角色是同一个 Button 组件：选中的用 primary，未选的用 outline。
    const main = document.querySelector('[data-role="main"]') as HTMLElement;
    const subagent = document.querySelector('[data-role="subagent"]') as HTMLElement;
    expect(main.tagName).toBe("BUTTON");
    expect(subagent.tagName).toBe("BUTTON");
    expect(main.getAttribute("aria-pressed")).toBe("true");
    expect(subagent.getAttribute("aria-pressed")).toBe("true");

    // 点一下取消 `subagent`：写回的是去掉它的那份数组。
    fireEvent.click(subagent);
    expect(page.sets.at(-1)).toEqual({ path: ["modes", "coding", "role"], value: ["main"] });

    // 注入面的两个开关是官方 Switch（`role="switch"`，无可见文本，标签由字段块给）。
    const switches = within(card("coding")).getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(switches[0]?.getAttribute("aria-label")).toBe(bundleZh["field.instructions"]);

    // 这三类字段都是右置行：左列是标签与说明，控件贴最右。
    const field = document.querySelector('[data-field="modes.coding.instructions"]') as HTMLElement;
    const row = field.children[0] as HTMLElement;
    expect(row.children).toHaveLength(2);
    // 左列是标签与说明，右列是控件本身。
    expect(row.children[0]?.textContent).toContain(bundleZh["field.instructions"]);
    expect(row.children[0]?.textContent).toContain(bundleZh["hint.instructions"]);
    expect(row.children[1]?.getAttribute("role")).toBe("switch");
  });

  it("`noop` 不给删：没有删除入口，只有一句说明", () => {
    renderPage();
    fireEvent.click(within(card("noop")).getByText("原样模式"));

    const noop = card("noop");
    expect(noop.getAttribute("data-deletable")).toBe("false");
    expect(within(noop).queryByRole("button", { name: "删除模式 原样模式" })).toBeNull();
    expect(within(noop).getByText(bundleZh.protected)).toBeTruthy();
    // 其余模式照旧有删除入口。
    fireEvent.click(within(card("coding")).getByText("编码模式"));
    expect(within(card("coding")).getByRole("button", { name: "删除模式 编码模式" })).toBeTruthy();
  });

  it("编辑字段：动作带着真实路径上报", () => {
    const page = renderPage();
    fireEvent.click(within(card("coding")).getByText("编码模式"));

    const name = document.querySelector(
      '[data-field="modes.coding.name"] input',
    ) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "编码模式（改）" } });
    expect(page.edits.at(-1)).toEqual({
      path: ["modes", "coding", "name"],
      text: "编码模式（改）",
    });
  });

  it("删除要过确认弹窗：取消不删、确认才删，确认按钮是危险配色", async () => {
    const page = renderPage();
    fireEvent.click(within(card("coding")).getByText("编码模式"));

    // 卡片头的删除入口是纯图标按钮（`IconButton`，primitives）：只有图标（无文字），名字走无障碍名；
    // 它的几何与危险配色归 primitives，这里只钉"入口是它、删除动作照旧"。
    const remove = within(card("coding")).getByRole("button", { name: /^删除模式/u });
    expect(remove.textContent).toBe("");

    // 取消：什么都没发生（草稿也没动）。
    fireEvent.click(remove);
    const cancelled = await screen.findByRole("dialog");
    expect(within(cancelled).getByText(bundleZh["remove.title"])).toBeTruthy();
    fireEvent.click(within(cancelled).getByRole("button", { name: bundleZh["remove.cancel"] }));
    expect(page.removed).toEqual([]);

    // 确认：写回的是被点名的那个模式，确认按钮挂上错误色填充的 class。
    fireEvent.click(within(card("coding")).getByRole("button", { name: /^删除模式/u }));
    const confirmed = await screen.findByRole("dialog");
    const confirm = within(confirmed).getByRole("button", { name: bundleZh["remove.confirm"] });
    expect(confirm.className).toContain("cls-");
    fireEvent.click(confirm);
    expect(page.removed).toEqual(["coding"]);
    expect(styles.dangerFill["--dsw-alias-button-primary-fill"]).toBe(
      "var(--dsw-alias-state-error-primary)",
    );
  });

  it("名单是标签输入：回车确认一个，粘贴逗号分隔的一串拆成多个", () => {
    const page = renderPage();
    fireEvent.click(within(card("coding")).getByText("编码模式"));

    const input = within(card("coding")).getByLabelText(
      bundleZh["field.allowTools"],
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "read" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(page.sets.at(-1)).toEqual({ path: ["modes", "coding", "allowTools"], value: ["read"] });

    // 粘贴：中英逗号、分号、换行都是分隔符，去空白、去重、保序。
    fireEvent.paste(input, {
      clipboardData: { getData: () => "write, bash；read\nls" },
    });
    expect(page.sets.at(-1)).toEqual({
      path: ["modes", "coding", "allowTools"],
      value: ["read", "write", "bash", "ls"],
    });
  });

  it("添加模式与保存：一个入口写 id，一次保存写全部改动", () => {
    const page = renderPage();

    const input = document.querySelector('[data-field="new-mode"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: bundleZh["add.confirm"] }));
    expect(page.added).toEqual(["draft"]);

    fireEvent.click(screen.getByRole("button", { name: bundleZh.save }));
    expect(page.saved).toHaveBeenCalledTimes(1);
  });
});
