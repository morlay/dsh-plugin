/**
 * 提示面的行为：业务注册同步读数（dict 的候选键、字段的候选值与文案），页面的可添加项与选择器都从它来。
 *
 * 盯的接缝是**注册 → 读数**：读数是同步的（投影发生在渲染帧里），注册与注销都要通知订阅者（页面据此重投影）；
 * 路径可以写模板（`*` 段），一次注册覆盖每个动态键。
 */

import z from "@deepseek-ai/schemastery";
import { describe, expect, it, vi } from "vitest";
import { addableAt } from "../client/controller.ts";
import { SchemaFormHints } from "../client/hints.ts";
import { projectNode, type FieldNode } from "../client/schema-node.ts";

/** 服务只要一个能 provide 自己的 ctx。 */
function service() {
  return new SchemaFormHints({ reflect: { provide: () => {} } } as never);
}

describe("候选键的注册面", () => {
  it("注册后能读到，注销后读不到", () => {
    const hints = service();
    const off = hints.suggestKeys("session-mode", ["models"], () => ["coding", "chat"]);

    expect(hints.keysFor("session-mode", ["models"])).toEqual(["coding", "chat"]);
    expect(hints.keysFor("session-mode", ["other"])).toEqual([]);

    off();
    expect(hints.keysFor("session-mode", ["models"])).toEqual([]);
  });

  it("注册与注销各通知一次，refresh 也能主动通知", () => {
    const hints = service();
    const listener = vi.fn();
    const offSubscribe = hints.subscribe(listener);

    const off = hints.suggestKeys("row", ["m"], () => []);
    hints.refresh();
    off();

    expect(listener).toHaveBeenCalledTimes(3);
    offSubscribe();
  });

  it("同一处重复注册以最后一次为准", () => {
    const hints = service();
    hints.suggestKeys("row", ["m"], () => ["a"]);
    hints.suggestKeys("row", ["m"], () => ["b"]);

    expect(hints.keysFor("row", ["m"])).toEqual(["b"]);
  });
});

describe("这一层能加什么", () => {
  /** 字段树里某个路径上的节点。 */
  const nodeAt = (root: FieldNode, key: string): FieldNode => {
    if (root.type !== "object") throw new Error("expected object");
    const field = root.fields.find((candidate) => candidate.key === key);
    if (field === undefined) throw new Error(`no field ${key}`);
    return field;
  };

  it("字典：候选里有、值里没有的键成为可添加项", () => {
    const root = projectNode(
      new z(z.object({ models: z.dict(z.object({ provider: z.string() })) }).toJSON()),
    );
    const addable = addableAt(
      nodeAt(root, "models"),
      ["models"],
      { chat: { provider: "ollama" } },
      {
        keysFor: (path) => (path.join(".") === "models" ? ["coding", "chat"] : []),
      },
    );

    expect(addable).toEqual([{ key: "coding", description: undefined }]);
  });

  it("字典：没有候选读数时加不了候选（页面上仍可自由敲键名）", () => {
    const root = projectNode(
      new z(z.object({ models: z.dict(z.object({ provider: z.string() })) }).toJSON()),
    );

    expect(addableAt(nodeAt(root, "models"), ["models"], {}, undefined)).toEqual([]);
  });

  it("对象：值里没有的声明字段成为可添加项，并带自己的说明", () => {
    const root = projectNode(
      new z(z.object({ note: z.string().description("备注"), retry: z.number() }).toJSON()),
    );

    expect(addableAt(root, [], { retry: 1 }, undefined)).toEqual([
      { key: "note", description: "备注" },
    ]);
  });

  it("对象：必填字段不进候选（它已经占着行了）", () => {
    const root = projectNode(
      new z(z.object({ host: z.string().required(), note: z.string() }).toJSON()),
    );

    expect(addableAt(root, [], {}, undefined)).toEqual([{ key: "note", description: undefined }]);
  });

  it("数组：不给候选（它的「添加一项」是追加空项）", () => {
    const root = projectNode(new z(z.object({ tags: z.array(z.string()) }).toJSON()));

    expect(addableAt(nodeAt(root, "tags"), ["tags"], [], undefined)).toEqual([]);
  });
});

describe("候选值", () => {
  it("注册与注销候选读数，注销只认自己那一次", () => {
    const hints = service();

    const first = hints.select("row", ["provider"], { options: () => [{ value: "a" }] });
    const second = hints.select("row", ["provider"], { options: () => [{ value: "b" }] });

    expect(hints.selectFor("row", ["provider"])?.options(() => undefined)).toEqual([
      { value: "b" },
    ]);
    first();
    expect(hints.selectFor("row", ["provider"])?.options(() => undefined)).toEqual([
      { value: "b" },
    ]);
    second();
    expect(hints.selectFor("row", ["provider"])).toBeUndefined();
  });

  it("注册与注销都通知一次", () => {
    const hints = service();

    const seen: number[] = [];
    hints.subscribe(() => {
      seen.push(1);
    });

    const off = hints.select("row", ["model"], { options: () => [] });
    off();

    expect(seen).toHaveLength(2);
  });
});

describe("模板路径", () => {
  it("注册一次 `models.*.provider` 就覆盖每个键", () => {
    const hints = service();
    const off = hints.select("session-mode", ["models", "*", "provider"], {
      options: () => [{ value: "a" }],
    });

    expect(
      hints.selectFor("session-mode", ["models", "coding", "provider"])?.options(() => undefined),
    ).toEqual([{ value: "a" }]);
    expect(
      hints.selectFor("session-mode", ["models", "chat", "provider"])?.options(() => undefined),
    ).toEqual([{ value: "a" }]);
    // 精确路径优先于模板。
    const exact = hints.select("session-mode", ["models", "chat", "provider"], {
      options: () => [{ value: "b" }],
    });
    expect(
      hints.selectFor("session-mode", ["models", "chat", "provider"])?.options(() => undefined),
    ).toEqual([{ value: "b" }]);
    exact();
    off();
  });

  it("文案也能按模板注册", () => {
    const hints = service();
    const off = hints.describe("session-mode", ["models", "*", "model"], () => ({ label: "模型" }));

    expect(hints.textFor("session-mode", ["models", "coding", "model"])).toEqual({ label: "模型" });

    off();
  });
});

describe("具名候选源", () => {
  it("注册后能按名字读到，注销只认自己那一次", () => {
    const hints = service();
    const first = hints.source("llm-providers", { options: () => [{ value: "a" }] });
    const second = hints.source("llm-providers", { options: () => [{ value: "b" }] });

    expect(hints.sourceFor("llm-providers")?.options(() => undefined)).toEqual([{ value: "b" }]);
    first();
    expect(hints.sourceFor("llm-providers")?.options(() => undefined)).toEqual([{ value: "b" }]);
    second();
    expect(hints.sourceFor("llm-providers")).toBeUndefined();
  });
});
