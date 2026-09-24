/**
 * 装上本包时的注册面：字典、Factory（字段槽的声明者）与按行自动注册的入口。
 *
 * slots / locale / remote 是外部框架面，这里用最小替身记录**注册事实**——Factory 的 children 声明、行入口的 key 与
 * 兜底 priority、不可渲染的行不占入口。真实槽位声明校验在上游包内完成。
 */

import type { BundleInfo, SettingsNamespaceView } from "@deepseek-ai/dsh-api-remotes/client";
import z from "@deepseek-ai/schemastery";
import { describe, expect, it, vi } from "vitest";
import { NS, apply, inject } from "../client/index.ts";
import { fakeDescribe } from "../testing/fake-describe.ts";
import { FakeScope } from "../testing/fake-scope.ts";

function view(
  ns: string,
  schema: z,
  overrides: Partial<SettingsNamespaceView> = {},
): SettingsNamespaceView {
  return {
    ns,
    schema: schema.toJSON() as never,
    value: {},
    autoGenerate: true,
    applies: "live",
    secrets: [],
    revision: 1,
    ...overrides,
  } as SettingsNamespaceView;
}

function bundle(name: string, rowIds: readonly string[]): BundleInfo {
  return {
    name,
    enabled: true,
    installed: true,
    optional: false,
    removable: true,
    rows: rowIds.map((rowId) => ({ rowId, moduleName: rowId })),
    overrides: [],
  } as BundleInfo;
}

interface Registered {
  slot: string;
  options: Record<string, unknown>;
  component: unknown;
}

/** 最小替身：记录槽位注册、字典与 Factory，并给出 describe / bundle 读面。 */
function bench(options: {
  namespaces: readonly SettingsNamespaceView[];
  bundles: readonly BundleInfo[];
}) {
  const registrations: Registered[] = [];
  const factories: Registered[] = [];
  const dictionaries: string[] = [];
  const effects: string[] = [];
  const describeFace = fakeDescribe(options.namespaces);
  const scope = new FakeScope();
  const ctx = {
    // cordis 的服务基类在构造时经 ctx.reflect 往 ctx 上 provide 自己。
    reflect: { provide: () => {}, set: () => {}, get: () => undefined },
    effect: (effect: () => unknown, label: string) => {
      effects.push(label);
      return effect();
    },
    locale: {
      register: (ns: string) => {
        dictionaries.push(ns);
      },
      bind: () => (key: string) => key,
      resolveText: (text: unknown) => (typeof text === "string" ? text : ""),
    },
    slots: {
      registerFactory: (slotOptions: Record<string, unknown>, component: unknown) => {
        factories.push({ slot: String(slotOptions["name"]), options: slotOptions, component });
        return () => {};
      },
      register: (slotOptions: Record<string, unknown>, component: unknown) => {
        registrations.push({ slot: String(slotOptions["name"]), options: slotOptions, component });
        return () => {};
      },
      inject: (_slot: string, factory: () => unknown) => factory(),
    },
    configForms: {
      describe: () => describeFace,
      get: () => scope,
    },
    settingsSchema: {
      rehydrate: (serialized: unknown) => new z(serialized as never),
      validate: () => undefined,
    },
    remote: {
      pluginManager: {
        listBundles: () => Promise.resolve({ ok: true as const, value: options.bundles }),
      },
      $on: (_event: string, _listener: (...params: never[]) => void) => () => {},
    },
  };
  return { ctx, registrations, factories, dictionaries, effects };
}

describe("装上本包的注册面", () => {
  it("只声明用到的服务", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "configForms",
      "settingsSchema",
      "remote",
      "remote.pluginManager",
    ]);
  });

  it("注册自己的字典与表单 Factory，Factory 声明字段槽", () => {
    const b = bench({ namespaces: [], bundles: [] });

    apply(b.ctx as never);

    expect(b.dictionaries).toEqual([NS]);
    expect(b.factories).toHaveLength(1);
    expect(b.factories[0]?.options).toMatchObject({
      scope: "root",
      locale: NS,
      children: { "settings.schema-form.field": { kind: "chain", scope: "root" } },
    });
  });

  it("把可渲染的行注册到自己的配置入口（key = bundle#行 id，priority 让手写页遮住）", async () => {
    const b = bench({
      namespaces: [view("subagent-fork", z.object({ maxDepth: z.number() }))],
      bundles: [bundle("@morlay/dsh-subagent", ["subagent-fork"])],
    });

    apply(b.ctx as never);
    await vi.waitFor(() => {
      expect(b.registrations).toHaveLength(1);
    });

    expect(b.registrations[0]).toMatchObject({
      slot: "plugins.row.config",
      options: {
        key: "@morlay/dsh-subagent#subagent-fork",
        priority: 100,
        locale: NS,
      },
    });
    expect(typeof b.registrations[0]?.component).toBe("function");
  });

  it("schema 不是对象的行不占入口", async () => {
    const b = bench({
      namespaces: [view("odd", z.string())],
      bundles: [bundle("pkg", ["odd"])],
    });

    apply(b.ctx as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(b.registrations).toEqual([]);
  });

  it("host 不服务任何命名空间时一个入口都不注册", async () => {
    const b = bench({ namespaces: [], bundles: [] });

    apply(b.ctx as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(b.registrations).toEqual([]);
  });

  it("行注册项在 page 视图才渲染表单，summary 不画东西", async () => {
    const rendered: { ns: string }[] = [];
    const b = bench({
      namespaces: [view("row", z.object({ retry: z.number() }))],
      bundles: [bundle("pkg", ["row"])],
    });
    apply(b.ctx as never);
    await vi.waitFor(() => {
      expect(b.registrations).toHaveLength(1);
    });

    const component = b.registrations[0]?.component as (props: Record<string, unknown>) => unknown;
    const summary = component({
      view: "summary",
      renderFactorySlot: () => {
        throw new Error("summary 不该渲染表单");
      },
    });
    expect(summary).toBeNull();

    component({
      view: "page",
      renderFactorySlot: (name: string, props: { ns: string }) => {
        expect(name).toBe("settings.schema-form.form");
        rendered.push({ ns: props.ns });
        return null;
      },
    });
    expect(rendered).toEqual([{ ns: "row" }]);
  });
});
