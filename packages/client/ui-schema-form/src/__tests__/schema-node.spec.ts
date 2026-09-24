/**
 * schema 投影的行为：host 发来的 `schema.toJSON()` 往返一次（rehydrate）后，投影成渲染层要的字段树。
 *
 * 盯的接缝是**结构**：哪些字段/子节点出现、路径怎么拼、meta 怎么归一化、哪些类型只读、递归与共享
 * 引用怎么收口。这里不含任何渲染和值——值在草稿模型（`draft.spec.ts`）与渲染（`fields.spec.tsx`）。
 */

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import {
  mergeKeyConflict,
  projectNode,
  unionOf,
  variantChoices,
  variantOf,
  walkFields,
} from "../client/schema-node.ts";

/** 走一遍设置流的往返：host 发 `schema.toJSON()`，客户端 rehydrate 后再投影。 */
function projected(schema: z, path: readonly string[] = []) {
  return projectNode(new z(schema.toJSON()), path);
}

describe("schema 投影", () => {
  it("对象的字段按声明顺序出现，子路径从段根拼出", () => {
    const node = projected(z.object({ retry: z.number(), label: z.string() }), ["llm"]);

    expect(node.type).toBe("object");
    if (node.type !== "object") throw new Error("expected object");
    expect(node.fields.map((field) => field.key)).toEqual(["retry", "label"]);
    expect(node.fields[1]?.path).toEqual(["llm", "label"]);
  });

  it("隐藏字段不进入字段树", () => {
    const node = projected(z.object({ shown: z.string(), hidden: z.string().hidden() }));

    if (node.type !== "object") throw new Error("expected object");
    expect(node.fields.map((field) => field.key)).toEqual(["shown"]);
  });

  it("meta 归一化：默认值、必需、角色、界限、步长、校验、说明、徽标、链接", () => {
    const node = projected(
      z.object({
        key: z.string().role("secret").description("API key").comment("写入即生效"),
        limit: z.number().min(1).max(9).step(2).default(3),
        name: z.string().required().pattern(/^sk-/).deprecated().link("https://example.com"),
      }),
    );

    if (node.type !== "object") throw new Error("expected object");
    const [key, limit, name] = node.fields;
    expect(key?.meta).toMatchObject({
      role: "secret",
      secret: true,
      description: "API key",
      comment: "写入即生效",
    });
    expect(limit?.meta).toMatchObject({
      hasDefault: true,
      defaultValue: 3,
      min: 1,
      max: 9,
      step: 2,
      required: false,
    });
    expect(name?.meta).toMatchObject({
      required: true,
      pattern: "^sk-",
      badges: ["deprecated"],
      link: "https://example.com",
    });
  });

  it("没有默认值的字段不会被当成有默认值", () => {
    const node = projected(z.object({ a: z.string() }));

    if (node.type !== "object") throw new Error("expected object");
    expect(node.fields[0]?.meta.hasDefault).toBe(false);
  });

  it("dict 给出键与值两个节点，占位段留给渲染层按真实键替换", () => {
    const node = projected(z.dict(z.number(), z.string()), ["models"]);

    if (node.type !== "dict") throw new Error("expected dict");
    expect(node.keyNode.type).toBe("string");
    expect(node.valueNode.type).toBe("number");
    expect(node.valueNode.path).toEqual(["models", "*"]);
  });

  it("array 给出 item，tuple 给出定长 items", () => {
    const list = projected(z.array(z.string()), ["tags"]);
    const pair = projected(z.tuple([z.string(), z.number()]), ["pair"]);

    if (list.type !== "array") throw new Error("expected array");
    if (pair.type !== "tuple") throw new Error("expected tuple");
    expect(list.item.path).toEqual(["tags", "*"]);
    expect(pair.items.map((item) => item.type)).toEqual(["string", "number"]);
    expect(pair.items[0]?.path).toEqual(["pair", "0"]);
  });

  it("成员全是字面量的 union 给出可选项，各成员仍是节点", () => {
    const node = projected(z.union(["a", "b"]));

    if (node.type !== "union") throw new Error("expected union");
    expect(node.choices).toEqual(["a", "b"]);
    expect(node.variants.map((variant) => variant.type)).toEqual(["const", "const"]);
  });

  it("对象成员的 union 不给可选项，保留各变体供判别式选择", () => {
    const node = projected(
      z.union([
        z.object({ kind: z.const("api"), url: z.string() }),
        z.object({ kind: z.const("cli"), command: z.string() }),
      ]),
    );

    if (node.type !== "union") throw new Error("expected union");
    expect(node.choices).toBeUndefined();
    expect(node.variants.map((variant) => variant.type)).toEqual(["object", "object"]);
  });

  it("判别标签：显式声明优先，否则所有对象成员共有的那个唯一常量字段", () => {
    const union = z.union([
      z.object({ kind: z.const("api"), url: z.string() }),
      z.object({ kind: z.const("cli"), command: z.string() }),
    ]);
    const explicit = z
      .union([
        z.object({ type: z.const("a"), x: z.string() }),
        z.object({ type: z.const("b"), y: z.string() }),
      ])
      .role("union", { tag: "type" });
    const ambiguous = z.union([
      z.object({ kind: z.const("api"), mode: z.const("fast"), url: z.string() }),
      z.object({ kind: z.const("cli"), mode: z.const("slow"), command: z.string() }),
    ]);

    const inferred = projected(union);
    const declared = projected(explicit);
    const none = projected(ambiguous);

    if (inferred.type !== "union" || declared.type !== "union" || none.type !== "union") {
      throw new Error("expected unions");
    }
    expect(inferred.tagKey).toBe("kind");
    expect(declared.tagKey).toBe("type");
    expect(none.tagKey).toBeUndefined();
  });

  it("按值展开时用判别标签选中变体（不是靠成员顺序）", () => {
    const union = projected(
      z.union([
        z.object({ kind: z.const("api"), url: z.string() }),
        z.object({ kind: z.const("cli"), command: z.string() }),
      ]),
    );

    const walked = walkFields(union, { kind: "cli", command: "run" }).filter(
      (item) => item.path.length > 0,
    );

    expect(walked.map((item) => item.node.key)).toEqual(["kind", "command"]);
  });

  it("共享判别字段 + const 分支的 intersect：同一路径只出现一次，分支按 tag 展开", () => {
    const schema = z.intersect([
      z.object({ shared: z.string(), type: z.union(["foo", "bar"]).required() }),
      z.union([
        z.object({ type: z.const("foo").required(), value: z.number().default(114514) }),
        z.object({ type: z.const("bar").required(), text: z.string() }),
      ]),
    ]);
    const node = projected(schema);

    expect(node.type).toBe("intersect");

    const bar = walkFields(node, { shared: "s", type: "bar", text: "t" });
    expect(bar.map((item) => item.path.join("."))).toEqual(["", "shared", "type", "text"]);
    const typeField = bar.find((item) => item.path.join(".") === "type")?.node;
    // 共享层那个可编辑的选择器留下，分支里同路径的 const 不再重复出现。
    if (typeField?.type !== "union") throw new Error("expected the shared discriminator field");
    expect(typeField.choices).toEqual(["foo", "bar"]);

    const foo = walkFields(node, { shared: "s", type: "foo", value: 1 });
    expect(foo.map((item) => item.path.join("."))).toEqual(["", "shared", "type", "value"]);
    expect(foo.find((item) => item.path.join(".") === "value")?.node.meta.hasDefault).toBe(true);

    // 非必填、值里也没有的字段不占行（加进来之前页面不给它位置）。
    const empty = walkFields(node, { shared: "s", type: "foo" });
    expect(empty.map((item) => item.path.join("."))).toEqual(["", "shared", "type"]);
  });

  it("必填字段值里没有也占行；非必填的没值就不占行", () => {
    const node = projected(z.object({ host: z.string().required(), note: z.string() }));

    expect(walkFields(node, {}).map((item) => item.path.join("."))).toEqual(["", "host"]);
    expect(walkFields(node, { note: "x" }).map((item) => item.path.join("."))).toEqual([
      "",
      "host",
      "note",
    ]);
  });

  it("intersect 保留各成员", () => {
    const node = projected(z.intersect([z.object({ a: z.string() }), z.object({ b: z.number() })]));

    if (node.type !== "intersect") throw new Error("expected intersect");
    expect(node.members.map((member) => member.type)).toEqual(["object", "object"]);
  });

  it("bitset 给出位名与位值", () => {
    const node = projected(z.bitset({ read: 1, write: 2 }));

    if (node.type !== "bitset") throw new Error("expected bitset");
    expect(node.bits).toEqual([
      { name: "read", bit: 1 },
      { name: "write", bit: 2 },
    ]);
  });

  it("const 给出值", () => {
    const node = projected(z.const("fixed"));

    if (node.type !== "const") throw new Error("expected const");
    expect(node.value).toBe("fixed");
  });

  it("any 与 never 是叶子", () => {
    expect(projected(z.any()).type).toBe("any");
    expect(projected(z.never()).type).toBe("never");
  });

  it("transform 按 inner 的类型呈现，并标记不可编辑的原因", () => {
    const node = projected(z.transform(z.string().role("datetime"), (value) => new Date(value)));

    expect(node.type).toBe("string");
    expect(node.readOnly).toBe("transform");
    expect(node.meta.role).toBe("datetime");
  });

  it("function 与 is 标记为不可编辑", () => {
    expect(projected(z.function()).readOnly).toBe("function");
    expect(projected(z.is(Date)).readOnly).toBe("constructor");
  });

  it("lazy 保留一层，inner 在里面", () => {
    const node = projected(z.lazy(() => z.string()));

    if (node.type !== "lazy") throw new Error("expected lazy");
    expect(node.inner.type).toBe("string");
  });

  it("数组的项身份：显式声明优先，否则 item 上的 `id` 字段", () => {
    const declared = projected(
      z.array(z.object({ key: z.string() })).role("items", { mergeKey: "key" }),
      ["rows"],
    );
    const inferred = projected(z.array(z.object({ id: z.string(), url: z.string() })), [
      "providers",
    ]);
    const none = projected(z.array(z.string()), ["tags"]);

    if (declared.type !== "array" || inferred.type !== "array" || none.type !== "array") {
      throw new Error("expected arrays");
    }
    expect(declared.mergeKey).toBe("key");
    expect(inferred.mergeKey).toBe("id");
    expect(none.mergeKey).toBeUndefined();
  });

  it("按值展开时，数组成员的显示名取它自己的项身份", () => {
    const node = projected(z.array(z.object({ id: z.string(), url: z.string() })), ["providers"]);

    const walked = walkFields(node, [
      { id: "a", url: "u" },
      { id: "b", url: "v" },
    ]);

    const rows = walked.filter((item) => item.path.length === 2 && item.path[1] !== undefined);
    expect(rows.map((item) => item.node.label)).toEqual(["a", "b"]);
  });

  it("项身份重复或为空时给出冲突（重复的报出后一项的位置）", () => {
    const node = projected(z.array(z.object({ id: z.string() })), ["providers"]);

    expect(mergeKeyConflict(node, [{ id: "a" }, { id: "b" }])).toBeUndefined();
    expect(mergeKeyConflict(node, [{ id: "a" }, { id: "a" }])).toEqual({
      kind: "duplicate",
      path: ["providers", "1"],
      mergeKey: "id",
      value: "a",
    });
    expect(mergeKeyConflict(node, [{ id: "" }])).toEqual({
      kind: "missing",
      path: ["providers", "0"],
      mergeKey: "id",
      value: "",
    });
  });

  it("项身份的检查落在嵌套的数组上", () => {
    const node = projected(z.object({ groups: z.array(z.object({ id: z.string() })) }));

    expect(mergeKeyConflict(node, { groups: [{ id: "a" }, { id: "a" }] })).toEqual({
      kind: "duplicate",
      path: ["groups", "1"],
      mergeKey: "id",
      value: "a",
    });
  });

  it("自引用的 schema 不会无限展开：回到祖先的分支收口成 recursive 节点", () => {
    const config: z = z.object({
      name: z.string(),
      children: z.array(z.lazy((): z => config)),
    });

    const node = projected(config);

    if (node.type !== "object") throw new Error("expected object");
    const children = node.fields[1];
    if (children?.type !== "array") throw new Error("expected array");
    if (children.item.type !== "lazy") throw new Error("expected lazy");
    expect(children.item.inner.type).toBe("recursive");
    if (children.item.inner.type !== "recursive") throw new Error("expected recursive");
    expect(children.item.inner.origin).toBe("object");
  });
});

describe("union 的变体", () => {
  it("有判别标签：按标签值选支，切换选项写的是标签值", () => {
    const node = projected(
      z.union([
        z.object({ type: z.const("sqlite"), path: z.string() }),
        z.object({ type: z.const("postgres"), connectionString: z.string() }),
      ]),
    );

    const union = unionOf(node);
    if (union === undefined) throw new Error("expected union");
    expect(union.tagKey).toBe("type");
    expect(variantOf(union, { type: "postgres" }).key).toBe("");
    expect(variantChoices(union)).toEqual([
      { label: '"sqlite"', value: "sqlite" },
      { label: '"postgres"', value: "postgres" },
    ]);
    expect(variantOf(union, { type: "postgres" }).type).toBe("object");
    expect(
      walkFields(union, { type: "postgres", connectionString: "postgres://x" }).map((item) =>
        item.path.join("."),
      ),
    ).toEqual(["", "type", "connectionString"]);
    // 换一支之后另一支的字段不再出现。
    expect(walkFields(union, { type: "postgres" }).map((item) => item.path.join("."))).toEqual([
      "",
      "type",
    ]);
  });

  it("没有判别标签：按值的形状选支，切换选项写目标变体的空值", () => {
    const node = projected(z.object({ access: z.union([z.array(z.string()), z.string()]) }));

    const union = unionOf(node.type === "object" ? node.fields[0] : undefined);
    if (union === undefined) throw new Error("expected union");
    expect(union.tagKey).toBeUndefined();
    expect(variantOf(union, ["rw:/tmp"]).type).toBe("array");
    expect(variantOf(union, "rw:/tmp").type).toBe("string");
    // 切到"一段文本"写的是"还没有值"的判断位 `null`（容器那一支给空的容器）。
    expect(variantChoices(union)).toEqual([
      { label: "[ ]", value: [] },
      { label: '""', value: null },
    ]);
  });
});
