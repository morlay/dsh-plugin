/**
 * 行配置页的门面：这一行的 volatile 字段经 host 投影后，页面上应该看到**模式清单**（每个模式的字段）、默认模式，
 * 以及每个已有模式的默认模型行。
 *
 * 盯的接缝是 host 的 schema 投影 → 通用表单的字段树：用真的 `volatileForm` 与真的 `Config`，只把 settings 的
 * 读写面换成替身。
 */

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { SchemaFormController } from "@morlay/dsh-client-ui-schema-form/client";
import { volatileForm } from "../../../../../vendor/deepseek-harness/packages/settings/settings/src/schema.ts";
import { Config } from "../modes.ts";

const t = ((key: string) => key) as never;

/** 一段真实的 config 值：两个模式 + 没配过默认模型。 */
const section = {
  default: "coding",
  modes: {
    coding: {
      name: "编码",
      description: "",
      role: ["main"],
      persona: { prefix: "", suffix: "" },
      allowTools: ["read"],
      instructions: true,
      runtimeContext: true,
    },
    chat: {
      name: "闲聊",
      description: "",
      role: ["main"],
      persona: { prefix: "", suffix: "" },
      allowTools: ["web_search"],
      instructions: false,
      runtimeContext: true,
    },
  },
  models: {},
};

function mounted() {
  const form = volatileForm(Config as never) as z;
  const listeners = new Set<() => void>();
  const controller = new SchemaFormController("session-mode", {
    form: {
      getSnapshot: () => ({
        status: "ready",
        value: section,
        base: {},
        user: undefined,
        writable: true,
        revision: 1,
        mode: "host",
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      mutate: () => Promise.resolve(true),
      set: () => Promise.resolve(true),
      unset: () => Promise.resolve(true),
    } as never,
    describe: {
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
    } as never,
    rehydrate: (serialized: unknown) => new z(serialized as never) as never,
    validate: () => undefined,
    t,
    // 页面按模式清单列默认模型的行：读数就是同一行 config 里的模式 id。
    hints: {
      keysFor: (path) => (path.join(".") === "models" ? Object.keys(section.modes) : []),
      textFor: () => ({}),
    },
  });
  return controller;
}

describe("会话模式的行配置页", () => {
  it("页面上能看到模式清单：每个模式的字段都在字段树里", () => {
    const walked = mounted().face().hooks.schemaForm.getSnapshot().walked;
    const paths = walked.map((item) => item.path.join("."));

    expect(paths).toContain("default");
    expect(paths).toContain("modes");
    for (const key of [
      "name",
      "description",
      "role",
      "allowTools",
      "instructions",
      "runtimeContext",
    ]) {
      expect(paths).toContain(`modes.coding.${key}`);
      expect(paths).toContain(`modes.chat.${key}`);
    }
    // 模式是成员行：名字可见、能移除。
    const coding = walked.find((item) => item.path.join(".") === "modes.coding");
    expect(coding?.member).toMatchObject({ parent: ["modes"], key: "coding" });
  });

  it("值里还没有默认模型的模式：不占行，而是 `models` 那一层的可添加键", () => {
    const snapshot = mounted().face().hooks.schemaForm.getSnapshot();
    const members = snapshot.walked.filter((item) => item.member?.parent.join(".") === "models");

    expect(members).toEqual([]);
    expect(snapshot.addable.get(JSON.stringify(["models"]))?.map((option) => option.key)).toEqual([
      "coding",
      "chat",
    ]);
  });
});
