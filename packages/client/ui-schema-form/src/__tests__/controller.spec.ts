/**
 * 控制器的行为：一行的 schema 怎么变成字段表、编辑怎么反映到投影、行消失或 schema 变化时页面怎么变。
 *
 * 盯的接缝是**describe + 共享表单 → 页面读数**：字段表按真实键与索引展开、secret 槽单独标记、schema 变了只
 * 换字段树（草稿不丢）、行不在时 `configured=false`。
 */

import type { SettingsNamespaceView } from "@deepseek-ai/dsh-api-remotes/client";
import type { SchemaNode } from "@deepseek-ai/dsh-client-ui-settings/client";
import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { SchemaFormController, fieldKey } from "../client/controller.ts";
import { SessionPersistenceRdb } from "../../../../session/session-rdb/src/index.ts";
import type { SelectSpec } from "../client/hints.ts";
import { zh } from "../client/locales.ts";
import type { SchemaFormTranslate } from "../client/slot-contract.ts";
import { fakeDescribe } from "../testing/fake-describe.ts";
import { FakeScope } from "../testing/fake-scope.ts";

/** host 发来的命名空间视图：schema 走一遍 `toJSON()`（与真实流一致）。 */
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

const t = ((key: string, params?: Record<string, unknown>) => {
  const template = (zh as unknown as Record<string, string>)[key] ?? key;
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match, name: string) => {
        const value = params[name];
        return typeof value === "string" || typeof value === "number" ? String(value) : "";
      });
}) as unknown as SchemaFormTranslate;

/** 控制器：rehydrate 与校验都用真 schema（与 `ctx.settingsSchema` 同语义）。 */
function mounted(
  ns: string,
  scope: FakeScope,
  describeFace = fakeDescribe([]),
  hints?: {
    selectFor: (path: readonly string[]) => SelectSpec | undefined;
  },
) {
  const controller = new SchemaFormController(ns, {
    form: scope,
    describe: describeFace,
    ...(hints === undefined
      ? {}
      : { hints: { keysFor: () => [], textFor: () => ({}), selectFor: hints.selectFor } }),
    rehydrate: (serialized) => new z(serialized as never) as unknown as SchemaNode,
    t,
    validate: (schema, value) => {
      try {
        (schema as unknown as (input: unknown) => unknown)(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
  return { controller, state: () => controller.face().hooks.schemaForm.getSnapshot() };
}

describe("行配置控制器", () => {
  it("行没有被 describe 出来时不给页面（configured=false）", () => {
    const { state } = mounted("missing", new FakeScope());

    expect(state()).toMatchObject({ configured: false });
    expect(state().fields.size).toBe(0);
  });

  it("schema 是对象时给出按具体键与索引展开的字段表", () => {
    const describeFace = fakeDescribe([
      view(
        "row",
        z.object({
          retry: z.number(),
          tags: z.array(z.string()),
          models: z.dict(z.string()),
        }),
      ),
    ]);
    const scope = new FakeScope({ value: { retry: 1, tags: ["a", "b"], models: { chat: "m" } } });
    const { state } = mounted("row", scope, describeFace);

    expect(state()).toMatchObject({
      configured: true,
      available: true,
      writable: true,
      dirty: false,
    });
    expect([...state().fields.keys()]).toEqual([
      fieldKey([]),
      fieldKey(["retry"]),
      fieldKey(["tags"]),
      fieldKey(["tags", "0"]),
      fieldKey(["tags", "1"]),
      fieldKey(["models"]),
      fieldKey(["models", "chat"]),
    ]);
  });

  it("编辑只落在草稿上，投影立刻反映", () => {
    const describeFace = fakeDescribe([view("row", z.object({ retry: z.number() }))]);
    const scope = new FakeScope({ value: { retry: 1 } });
    const { controller, state } = mounted("row", scope, describeFace);
    const face = controller.face();

    face.set(["retry"], 5);

    expect(state()).toMatchObject({ dirty: true });
    expect(state().fields.get(fieldKey(["retry"]))).toMatchObject({ value: 5, overridden: true });
    expect(scope.writes).toEqual([]);
  });

  it("保存走共享配置表单的一次写", async () => {
    const describeFace = fakeDescribe([view("row", z.object({ retry: z.number() }))]);
    const scope = new FakeScope({ value: { retry: 1 } });
    const face = mounted("row", scope, describeFace).controller.face();

    face.set(["retry"], 5);
    face.save();

    await Promise.resolve();
    await Promise.resolve();
    expect(scope.writes).toEqual([[{ op: "set", path: ["retry"], value: 5 }]]);
  });

  it("schema 变了只换字段树，草稿不丢", () => {
    const describeFace = fakeDescribe([view("row", z.object({ retry: z.number() }))]);
    const scope = new FakeScope({ value: { retry: 1 } });
    const { controller, state } = mounted("row", scope, describeFace);
    controller.face().set(["retry"], 5);

    describeFace.publish([view("row", z.object({ retry: z.number(), label: z.string() }))]);

    // 新字段值里还没有：它不占行，进的是这一层的可添加项。
    expect([...state().fields.keys()]).toEqual([fieldKey([]), fieldKey(["retry"])]);
    expect(
      state()
        .addable.get(fieldKey([]))
        ?.map((option) => option.key),
    ).toEqual(["label"]);
    expect(state().fields.get(fieldKey(["retry"]))).toMatchObject({ value: 5, overridden: true });
  });

  it("数组的项身份重复时不发写，并把消息报到整段校验上", async () => {
    const describeFace = fakeDescribe([
      view(
        "row",
        z.object({
          providers: z.array(z.object({ id: z.string(), url: z.string() })),
        }),
      ),
    ]);
    const scope = new FakeScope({ value: { providers: [{ id: "a", url: "u" }] } });
    const { controller, state } = mounted("row", scope, describeFace);
    const face = controller.face();

    face.set(["providers", "1"], { id: "a", url: "v" });
    face.save();

    await Promise.resolve();
    await Promise.resolve();
    expect(scope.writes).toEqual([]);
    expect(state()).toMatchObject({ invalid: true });
    expect(state().violation).toContain("a");
  });

  it("数组的项身份不重复时照常保存", async () => {
    const describeFace = fakeDescribe([
      view(
        "row",
        z.object({
          providers: z.array(z.object({ id: z.string(), url: z.string() })),
        }),
      ),
    ]);
    const scope = new FakeScope({ value: { providers: [{ id: "a", url: "u" }] } });
    const face = mounted("row", scope, describeFace).controller.face();

    face.set(["providers", "1"], { id: "b", url: "v" });
    face.save();

    await Promise.resolve();
    await Promise.resolve();
    expect(scope.writes).toEqual([
      [{ op: "set", path: ["providers", "1"], value: { id: "b", url: "v" } }],
    ]);
  });

  it("共享判别字段 + const 分支的 intersect 顶层也能出页面", () => {
    const describeFace = fakeDescribe([
      view(
        "row",
        z.intersect([
          z.object({ shared: z.string(), type: z.union(["foo", "bar"]).required() }),
          z.union([
            z.object({ type: z.const("foo").required(), value: z.number().default(114514) }),
            z.object({ type: z.const("bar").required(), text: z.string() }),
          ]),
        ]),
      ),
    ]);
    const scope = new FakeScope({ value: { shared: "s", type: "foo", value: 3 } });
    const { state } = mounted("row", scope, describeFace);

    expect(state()).toMatchObject({ configured: true, available: true });
    expect([...state().fields.keys()]).toEqual([
      fieldKey([]),
      fieldKey(["shared"]),
      fieldKey(["type"]),
      fieldKey(["value"]),
    ]);
  });

  it("schema rehydrate 不了或段根不是对象时不给页面", () => {
    const broken = fakeDescribe([{ ...view("row", z.object({})), schema: "nonsense" as never }]);
    expect(mounted("row", new FakeScope(), broken).state()).toMatchObject({ configured: false });

    const notObject = fakeDescribe([view("row", z.string())]);
    expect(mounted("row", new FakeScope(), notObject).state()).toMatchObject({ configured: false });
  });

  it("secret 槽按路径标出来（值本身不回传）", () => {
    const describeFace = fakeDescribe([
      view("row", z.object({ key: z.string().role("secret") }), {
        secrets: [{ path: ["key"], set: true }],
      }),
    ]);
    const { state } = mounted("row", new FakeScope(), describeFace);

    expect(state().secrets.get(fieldKey(["key"]))).toBe(true);
  });

  it("收掉之后不再跟着 describe 变化", () => {
    const describeFace = fakeDescribe([view("row", z.object({ retry: z.number() }))]);
    const { controller, state } = mounted(
      "row",
      new FakeScope({ value: { retry: 1 } }),
      describeFace,
    );

    controller.dispose();
    describeFace.publish([view("row", z.object({ retry: z.number(), label: z.string() }))]);

    expect([...state().fields.keys()]).toEqual([fieldKey([]), fieldKey(["retry"])]);
  });
});

describe("字段的候选值", () => {
  it("提示面注册的候选出现在读数里，依赖的兄弟字段一改就重算", () => {
    const schema = z.object({
      models: z.dict(
        z.object({
          provider: z.string().role("select"),
          model: z.string().role("select"),
        }),
      ),
    });
    const describeFace = fakeDescribe([view("session-mode", schema)]);
    const scope = new FakeScope({ value: { models: { coding: { provider: "a", model: "m1" } } } });
    const { controller, state } = mounted("session-mode", scope, describeFace, {
      selectFor: (path) => {
        if (path.length !== 3) return undefined;
        if (path[2] === "provider") return { options: () => [{ value: "a" }, { value: "b" }] };
        if (path[2] !== "model") return undefined;
        return {
          dependsOn: [["provider"]],
          options: (read) =>
            read(["provider"]) === "b" ? [{ value: "m2", label: "b 家的 m2" }] : [{ value: "m1" }],
        };
      },
    });

    expect(state().options.get(fieldKey(["models", "coding", "provider"]))).toEqual([
      { value: "a" },
      { value: "b" },
    ]);
    expect(state().options.get(fieldKey(["models", "coding", "model"]))).toEqual([{ value: "m1" }]);

    controller.face().set(["models", "coding", "provider"], "b");

    expect(state().options.get(fieldKey(["models", "coding", "model"]))).toEqual([
      { value: "m2", label: "b 家的 m2" },
    ]);
  });

  it("字面量集合的 union 自带候选，不用业务注册", () => {
    const describeFace = fakeDescribe([
      view("row", z.object({ journalMode: z.union(["wal", "delete"]) })),
    ]);
    const scope = new FakeScope({ value: { journalMode: "wal" } });
    const { state } = mounted("row", scope, describeFace);

    expect(state().options.get(fieldKey(["journalMode"]))).toEqual([
      { value: "wal" },
      { value: "delete" },
    ]);
  });

  it("没注册候选的字段没有 options（仍旧是文本编辑）", () => {
    const describeFace = fakeDescribe([view("row", z.object({ note: z.string() }))]);
    const scope = new FakeScope({ value: { note: "x" } });
    const { state } = mounted("row", scope, describeFace);

    expect(state().options.get(fieldKey(["note"]))).toBeUndefined();
  });
});

describe("增删项走完整条路（投影 → 草稿 → 写）", () => {
  const schema = z.object({
    models: z.dict(z.string().default("x")),
    tags: z.array(z.number().default(7)),
  });

  it("字典加键：立刻出现在投影里，值取该节点的默认值，保存写出这一项", async () => {
    const describeFace = fakeDescribe([view("row", schema)]);
    const scope = new FakeScope({ value: { models: {}, tags: [] } });
    const { controller, state } = mounted("row", scope, describeFace);

    controller.face().addKey(["models"], "chat");

    expect(state().walked.map((item) => item.path.join("."))).toContain("models.chat");
    expect(state().fields.get(fieldKey(["models", "chat"]))).toMatchObject({
      value: "x",
      staged: true,
    });

    controller.face().save();
    await Promise.resolve();
    await Promise.resolve();

    expect(scope.writes).toEqual([[{ op: "set", path: ["models", "chat"], value: "x" }]]);
  });

  it("数组追加项：新项出现，值取 item 的默认值", () => {
    const describeFace = fakeDescribe([view("row", schema)]);
    const scope = new FakeScope({ value: { models: {}, tags: [] } });
    const { controller, state } = mounted("row", scope, describeFace);

    controller.face().appendItem(["tags"]);

    expect(state().walked.map((item) => item.path.join("."))).toContain("tags.0");
    expect(state().fields.get(fieldKey(["tags", "0"]))).toMatchObject({ value: 7 });
  });

  it("行 schema 换了之后，加进来的项跟着新 schema 取默认值", () => {
    const describeFace = fakeDescribe([view("row", z.object({ models: z.dict(z.string()) }))]);
    const scope = new FakeScope({ value: { models: {} } });
    const { controller, state } = mounted("row", scope, describeFace);

    describeFace.publish([view("row", z.object({ models: z.dict(z.string().default("new")) }))]);
    controller.face().addKey(["models"], "chat");

    expect(state().fields.get(fieldKey(["models", "chat"]))).toMatchObject({ value: "new" });
  });

  it("草稿标记：本页改过的字段 staged=true，撤回后回到 false", () => {
    const describeFace = fakeDescribe([view("row", schema)]);
    const scope = new FakeScope({ value: { models: {}, tags: [] } });
    const { controller, state } = mounted("row", scope, describeFace);
    const face = controller.face();

    face.set(["models", "chat"], "y");
    expect(state().fields.get(fieldKey(["models", "chat"]))).toMatchObject({ staged: true });

    face.revert(["models", "chat"]);
    // 撤回之后这一项本来就不在值里：它又退回"还没配"，页面上不再占行。
    expect(state().walked.map((item) => item.path.join("."))).not.toContain("models.chat");
  });
});

/** 判别式行 Config（`session-rdb`）的两个真场景：切换另一支、从候选补一个字段。 */
describe("判别式行 Config 的切换与补字段", () => {
  const value = { type: "sqlite", path: "/tmp/a.db" };

  it("切到另一支：type 行显示新值，那一支的字段跟着出现", () => {
    const describeFace = fakeDescribe([view("session-rdb", SessionPersistenceRdb.Config)]);
    const scope = new FakeScope({ value: { ...value } });
    const { controller, state } = mounted("session-rdb", scope, describeFace);

    controller.face().set(["type"], "postgres");

    expect(state().fields.get(fieldKey(["type"]))?.value).toBe("postgres");
    const paths = state().walked.map((item) => item.path.join("."));
    expect(paths).toContain("connectionString");
    expect(paths).not.toContain("path");
    expect(
      state()
        .addable.get(fieldKey([]))
        ?.map((option) => option.key),
    ).toEqual(["schema", "projectionCache"]);
  });

  it("从候选补一个带默认值的字段：行出现，值取默认值", () => {
    const describeFace = fakeDescribe([view("session-rdb", SessionPersistenceRdb.Config)]);
    const scope = new FakeScope({ value: { ...value } });
    const { controller, state } = mounted("session-rdb", scope, describeFace);
    controller.face().set(["type"], "postgres");

    controller.face().addKey([], "schema");

    expect(state().fields.get(fieldKey(["schema"]))?.value).toBe("public");
    expect(state().walked.map((item) => item.path.join("."))).toContain("schema");
    expect(
      state()
        .addable.get(fieldKey([]))
        ?.map((option) => option.key),
    ).toEqual(["projectionCache"]);
  });
});
