// @vitest-environment jsdom
// bundle 配置页的布局与交互：模式卡片默认收起、点开才出现字段；`noop` 没有删除入口；编辑与增删都只上报动作
// （真正的写盘归保存）。

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import z from "@deepseek-ai/schemastery";
import { afterEach, describe, expect, it, vi } from "vitest";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import { BundleConfigPage, type BundleConfigPageProps } from "../client/BundleConfigPage.tsx";
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
  const added: string[] = [];
  const removed: string[] = [];
  const saved = vi.fn();
  const wrapped = {
    ...face,
    editText: (path: readonly string[], text: string) => {
      edits.push({ path, text });
      face.editText(path, text);
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
  return { wrapped, dispose, edits, added, removed, saved };
}

function renderPage(): ReturnType<typeof mounted> {
  const mountedPage = mounted();
  const props = {
    view: "page",
    t,
    useBundleConfig: (selector: (state: unknown) => unknown) =>
      selector(mountedPage.wrapped.hooks.bundleConfig.getSnapshot()),
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

    expect(screen.getByText(bundleZh["default.label"])).toBeTruthy();
    fireEvent.click(within(card("coding")).getByText("编码模式"));

    expect(within(card("coding")).getByText(bundleZh["group.tools"])).toBeTruthy();
    expect(within(card("coding")).getByText(bundleZh["field.allowTools"])).toBeTruthy();
    const name = document.querySelector('[data-field="modes.coding.name"] input');
    expect(name).not.toBeNull();
    expect((name as HTMLInputElement).value).toBe("编码模式");
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

  it("编辑字段与删除模式：动作带着真实路径上报", () => {
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

    const addItem = within(card("coding")).getAllByRole("button", {
      name: bundleZh["list.add"],
    })[0];
    fireEvent.click(addItem as HTMLElement);

    fireEvent.click(within(card("coding")).getByRole("button", { name: "删除模式 编码模式" }));
    expect(page.removed).toEqual(["coding"]);
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
