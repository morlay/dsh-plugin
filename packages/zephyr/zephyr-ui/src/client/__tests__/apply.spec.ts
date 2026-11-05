// 装上本包时的注册面：提示面、字典与字段槽 Factory。
//
// slots / locale 是外部框架面，这里用最小替身记录**注册事实**——Factory 的 children 声明、字典注册与
// 提示面的幂等（inline 后每个消费行的产物里各带一份这份代码，都会调 apply）。

import { describe, expect, it } from "vitest";
import { NS, apply, inject } from "../schema-form/index.ts";
import { SchemaFormHintsDefault, SERVICE_NAME, schemaFormHintsOf } from "../schema-form/hints.ts";

interface Registered {
  slot: string;
  options: Record<string, unknown>;
  component: unknown;
}

// 最小替身：记录槽位注册与字典，并提供 apply 读的两个面（根 store 与 effect）。
function bench(options: { services?: readonly string[] } = {}) {
  const registrations: Registered[] = [];
  const factories: Registered[] = [];
  const dictionaries: string[] = [];
  const provided = new Map<string, unknown>(
    (options.services ?? []).map((name) => [name, {}] as const),
  );
  const ctx = {
    reflect: {
      provide: (name: string, value: unknown) => {
        provided.set(name, value);
        return () => {
          provided.delete(name);
        };
      },
      // 装配面按名字严格读（get(name, true)），运行期的「装过了吗」用宽松读。
      get: (name: string) => provided.get(name),
    },
    effect: (body: () => unknown) => body(),
    locale: {
      register: (ns: string) => {
        dictionaries.push(ns);
        return () => {};
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
    get: (name: string) => (provided.has(name) ? provided.get(name) : undefined),
    configForms: {
      describe: () => ({
        getSnapshot: () => ({ view: { namespaces: [] } }),
        subscribe: () => () => {},
      }),
      get: () => ({
        getSnapshot: () => ({}),
        subscribe: () => () => {},
        write: () => Promise.resolve(),
      }),
    },
    settingsSchema: {
      rehydrate: (serialized: unknown) => serialized,
      validate: () => undefined,
    },
  };
  // 服务挂在 root 上：替身把 root 指回自己。
  (ctx as Record<string, unknown>).root = ctx;
  return { ctx, registrations, factories, dictionaries, provided };
}

describe("装上本包的注册面", () => {
  it("只声明用到的服务", () => {
    expect(inject).toEqual(["slots", "locale", "configForms", "settingsSchema"]);
  });

  it("注册提示面、自己的字典与表单 Factory，Factory 声明字段槽", () => {
    const b = bench();

    apply(b.ctx as never);

    expect(b.provided.has(SERVICE_NAME)).toBe(true);
    expect(b.dictionaries).toEqual([NS]);
    expect(b.factories).toHaveLength(1);
    expect(b.factories[0]?.options).toMatchObject({
      scope: "root",
      locale: NS,
      children: { "settings.schema-form.field": { kind: "chain", scope: "root" } },
    });
  });

  // inline 后每个消费行的产物里各带一份本包代码、都会调 apply：同一运行时只装配一次。
  it("多份副本各自装上时只装配一次", () => {
    const b = bench();

    apply(b.ctx as never);
    apply(b.ctx as never);

    expect(b.dictionaries).toEqual([NS]);
    expect(b.factories).toHaveLength(1);
  });

  it("服务已在场（另一份副本装过）就不再装配", () => {
    const b = bench({ services: [SERVICE_NAME] });

    apply(b.ctx as never);

    expect(b.dictionaries).toEqual([]);
    expect(b.factories).toEqual([]);
  });

  // 挂上去的必须是真实现：业务从 schemaFormHintsOf 读到的就是它，空壳会让候选/文案/候选值全部静默失效。
  it("挂上的是提示面的实现，并且按名读得到", () => {
    const b = bench();

    apply(b.ctx as never);

    const hints = schemaFormHintsOf(b.ctx as never);
    expect(hints).toBeInstanceOf(SchemaFormHintsDefault);
    expect(hints?.keysFor("row", [])).toEqual([]);
  });

  it("一行入口都不注册（行配置入口不属于本包）", () => {
    const b = bench();

    apply(b.ctx as never);

    expect(b.registrations).toEqual([]);
  });
});
