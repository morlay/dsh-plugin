/**
 * 草稿模型的行为：暂存的编辑怎么变成 path op、什么时候挡住保存、host 拒绝后草稿还在不在。
 *
 * 盯的接缝是**草稿 → 写**这一条：编辑只落在草稿（host 一个写都没收到）、保存按 staged 顺序发一次
 * `mutate` 并带基准 revision、非法草稿挡保存、整段校验失败不发写、host 拒绝保留草稿、丢弃不发写。
 * 值从生效层读（用户层 presence 决定「已覆盖」），与渲染无关。
 */

import z from "@deepseek-ai/schemastery";
import { describe, expect, it, vi } from "vitest";
import { SchemaDraftModel, type ValidationFailure } from "../client/draft.ts";
import { projectNode } from "../client/schema-node.ts";
import { FakeScope } from "../testing/fake-scope.ts";

type Section = Record<string, unknown>;

/** 造一个模型：字段树来自真 schema 的投影，校验用真 schema（整段跑一次）。 */
function model(
  scope: FakeScope,
  schema: z,
  validate?: (value: Section) => ValidationFailure | undefined,
) {
  const instance = new SchemaDraftModel({
    scope,
    root: projectNode(new z(schema.toJSON())),
    validate: validate ?? (() => undefined),
  });
  const store = instance.bind(() => instance.shell());
  return { instance, shell: () => store.getSnapshot() };
}

describe("草稿模型", () => {
  it("初值来自生效层：不脏、无覆盖", () => {
    const scope = new FakeScope({ value: { retry: 3 }, user: { retry: 3 } });
    const { instance, shell } = model(scope, z.object({ retry: z.number() }));

    expect(shell()).toMatchObject({
      available: true,
      writable: true,
      dirty: false,
      invalid: false,
      failed: false,
    });
    expect(instance.field(["retry"])).toMatchObject({
      value: 3,
      overridden: true,
      invalid: undefined,
    });
  });

  it("用户层没有这个字段时不算覆盖", () => {
    const scope = new FakeScope({ value: { retry: 3 }, user: {} });
    const { instance } = model(scope, z.object({ retry: z.number() }));

    expect(instance.field(["retry"]).overridden).toBe(false);
  });

  it("编辑只落在草稿上：保存前 host 一个写都没收到", () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    const { instance, shell } = model(scope, z.object({ retry: z.number() }));

    instance.set(["retry"], 5);

    expect(shell().dirty).toBe(true);
    expect(instance.field(["retry"])).toMatchObject({ value: 5, overridden: true });
    expect(scope.writes).toEqual([]);
  });

  it("把字段改回生效值即不再脏（保存不会发写）", async () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    const { instance, shell } = model(scope, z.object({ retry: z.number() }));

    instance.set(["retry"], 5);
    instance.set(["retry"], 1);
    void instance.save();

    await Promise.resolve();
    expect(shell().dirty).toBe(false);
    expect(scope.writes).toEqual([]);
  });

  it("保存把草稿按 staged 顺序变成 path op，并带读回时的 revision 栅栏", async () => {
    const scope = new FakeScope({ value: { retry: 1, label: "a" } });
    const { instance, shell } = model(scope, z.object({ retry: z.number(), label: z.string() }));

    instance.set(["retry"], 5);
    instance.setText(["label"], "b", (text) => ({ kind: "value", value: text }));
    void instance.save();

    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });
    expect(scope.writes[0]).toEqual([
      { op: "set", path: ["retry"], value: 5 },
      { op: "set", path: ["label"], value: "b" },
    ]);
    expect(scope.fences[0]).toBe(7);
    await vi.waitFor(() => {
      expect(shell()).toMatchObject({ dirty: false, saving: false, failed: false });
    });
  });

  it("文本草稿保存前不解析：无效的文本挡住保存且不发写", async () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    const { instance, shell } = model(scope, z.object({ retry: z.number() }));
    const parse = (text: string) =>
      Number.isFinite(Number(text))
        ? { kind: "value" as const, value: Number(text) }
        : { kind: "invalid" as const, message: "要一个数" };

    instance.setText(["retry"], "abc", parse);

    expect(instance.field(["retry"])).toMatchObject({
      text: "abc",
      invalid: "要一个数",
      overridden: true,
    });
    expect(shell()).toMatchObject({ dirty: true, invalid: true });
    void instance.save();
    await Promise.resolve();
    expect(scope.writes).toEqual([]);
  });

  it("整段校验失败时不发写，并把消息报到 invalid", async () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    const { instance } = model(scope, z.object({ retry: z.number() }), (value) =>
      value["retry"] === 99 ? { message: "retry 不接受 99", path: ["retry"] } : undefined,
    );

    instance.set(["retry"], 99);
    void instance.save();

    await Promise.resolve();
    expect(scope.writes).toEqual([]);
    expect(instance.shell().invalid).toBe(true);
    expect(instance.violation()).toEqual({ message: "retry 不接受 99", path: ["retry"] });
  });

  it("host 拒绝时保留草稿并报失败", async () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    scope.accepted = false;
    const { instance, shell } = model(scope, z.object({ retry: z.number() }));

    instance.set(["retry"], 5);
    void instance.save();

    await vi.waitFor(() => {
      expect(shell().failed).toBe(true);
    });
    expect(shell()).toMatchObject({ dirty: true, saving: false });
    expect(instance.field(["retry"]).value).toBe(5);
  });

  it("恢复默认：发 unset，把字段交回组成层；用户层本来没有值时一个写都不发", async () => {
    const overridden = new FakeScope({
      value: { retry: 9 },
      user: { retry: 9 },
      base: { retry: 1 },
    });
    const first = model(overridden, z.object({ retry: z.number() }));

    first.instance.clear(["retry"]);
    expect(first.instance.field(["retry"])).toMatchObject({ overridden: false, value: 1 });
    void first.instance.save();

    await vi.waitFor(() => {
      expect(overridden.writes).toEqual([[{ op: "unset", path: ["retry"] }]]);
    });

    const fresh = new FakeScope({ value: { retry: 1 }, user: {} });
    const second = model(fresh, z.object({ retry: z.number() }));
    second.instance.clear(["retry"]);
    void second.instance.save();

    await Promise.resolve();
    expect(fresh.writes).toEqual([]);
  });

  it("丢弃草稿：回到生效值，host 一个写都没收到", () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    const { instance, shell } = model(scope, z.object({ retry: z.number() }));

    instance.set(["retry"], 5);
    instance.discard();

    expect(shell()).toMatchObject({ dirty: false, invalid: false });
    expect(instance.field(["retry"]).value).toBe(1);
    expect(scope.writes).toEqual([]);
  });

  it("数组追加按索引写、追加值取 item 的默认值；删除发 unset", async () => {
    const scope = new FakeScope({ value: { tags: ["a"] } });
    const { instance } = model(scope, z.object({ tags: z.array(z.string().default("new")) }));

    instance.appendItem(["tags"]);
    expect(instance.field(["tags", "1"]).value).toBe("new");
    instance.removeItem(["tags"], 0);
    void instance.save();

    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });
    expect(scope.writes[0]).toEqual([
      { op: "set", path: ["tags", "1"], value: "new" },
      { op: "unset", path: ["tags", "0"] },
    ]);
  });

  it("dict 增键用值节点的默认值，删键发 unset", async () => {
    const scope = new FakeScope({ value: { models: { chat: "x" } } });
    const { instance } = model(scope, z.object({ models: z.dict(z.string().default("m")) }));

    instance.addKey(["models"], "fast");
    expect(instance.field(["models", "fast"]).value).toBe("m");
    instance.removeKey(["models"], "chat");
    void instance.save();

    await vi.waitFor(() => {
      expect(scope.writes).toHaveLength(1);
    });
    expect(scope.writes[0]).toEqual([
      { op: "set", path: ["models", "fast"], value: "m" },
      { op: "unset", path: ["models", "chat"] },
    ]);
  });

  it("只读文档：保存不发写", async () => {
    const scope = new FakeScope({ value: { retry: 1 }, writable: false });
    const { instance, shell } = model(scope, z.object({ retry: z.number() }));

    instance.set(["retry"], 5);
    void instance.save();

    await Promise.resolve();
    expect(shell().writable).toBe(false);
    expect(scope.writes).toEqual([]);
  });

  it("host 不服务这个 namespace 时 available=false", () => {
    const scope = new FakeScope({ status: "unavailable", value: undefined, revision: undefined });
    const { shell } = model(scope, z.object({ retry: z.number() }));

    expect(shell()).toMatchObject({ available: false, dirty: false, invalid: false });
  });

  it("深路径编辑落在嵌套字段上", async () => {
    const scope = new FakeScope({ value: { limits: { depth: 1 } } });
    const { instance } = model(scope, z.object({ limits: z.object({ depth: z.number() }) }));

    instance.set(["limits", "depth"], 4);
    void instance.save();

    await vi.waitFor(() => {
      expect(scope.writes[0]).toEqual([{ op: "set", path: ["limits", "depth"], value: 4 }]);
    });
  });
});

describe("给一层加项", () => {
  it("对象加声明过的字段：值取该字段的默认值", async () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    const { instance } = model(
      scope,
      z.object({ retry: z.number(), note: z.string().default("hi") }),
    );

    instance.addKey([], "note");
    await instance.save();

    expect(scope.writes).toEqual([[{ op: "set", path: ["note"], value: "hi" }]]);
  });

  it("对象加没声明的字段：不写（写进去也会被 host 挡下）", async () => {
    const scope = new FakeScope({ value: { retry: 1 } });
    const { instance } = model(scope, z.object({ retry: z.number() }));

    instance.addKey([], "nope");
    await instance.save();

    expect(scope.writes).toEqual([]);
  });

  it("字典加任意键：值是「还没有值」的判断位（标量给 null，容器给空的容器）", async () => {
    const scope = new FakeScope({ value: { models: {} } });
    const { instance } = model(
      scope,
      z.object({ models: z.dict(z.string()), groups: z.dict(z.array(z.string())) }),
    );

    instance.addKey(["models"], "chat");
    instance.addKey(["groups"], "main");
    await instance.save();

    expect(scope.writes).toEqual([
      [
        { op: "set", path: ["models", "chat"], value: null },
        { op: "set", path: ["groups", "main"], value: [] },
      ],
    ]);
  });
});

it("加成对象：它的字段一次摆出来（有默认值给默认值、标量给 null、容器给空的容器）", async () => {
  const scope = new FakeScope({ value: {} });
  const { instance } = model(
    scope,
    z.object({
      cfg: z.object({
        host: z.string().default("h"),
        port: z.number(),
        tags: z.array(z.string()),
      }),
    }),
  );

  instance.addKey([], "cfg");
  await instance.save();

  expect(scope.writes).toEqual([
    [{ op: "set", path: ["cfg"], value: { host: "h", port: null, tags: [] } }],
  ]);
});

it("字段的默认值是 `null`（会话模式的 `defaultModel` 那种写法）时，加成仍把它的字段摆出来", async () => {
  const scope = new FakeScope({ value: {} });
  const { instance } = model(
    scope,
    z.object({
      defaultModel: z
        .object({ provider: z.string(), model: z.string() })
        .default(null as unknown as never),
    }),
  );

  instance.addKey([], "defaultModel");
  await instance.save();

  expect(scope.writes).toEqual([
    [{ op: "set", path: ["defaultModel"], value: { provider: null, model: null } }],
  ]);
});
