import { describe, expect, test } from "@morlay/zephyr/testing";
import { type Node, parseSource, walkAll } from "../ast.ts";
import { reflectModel } from "../reflection.ts";

// 包反射：JSDoc → description / summary / tags，成员签名与类型声明照原文。

const SOURCE = `/**
 * Host owner of the demo namespace. It answers one question.
 * @typert service demoService
 * @param ns - namespace name.
 */
export class DemoService extends TypertRemoteService {
  /**
   * Read one value.
   * @returns the value.
   */
  @Remote
  async read(ns: string): Promise<string> {
    return ns
  }
}
`;

function classOf(source: string): {
  file: ReturnType<typeof parseSource>;
  klass: Node;
  method: Node;
} {
  const file = parseSource("demo.ts", source);
  let klass: Node | undefined;
  let method: Node | undefined;
  walkAll(file.program, (node) => {
    if (klass === undefined && node["type"] === "ClassDeclaration") klass = node;
    if (method === undefined && node["type"] === "MethodDefinition") method = node;
  });
  return { file, klass: klass as Node, method: method as Node };
}

describe("包反射", () => {
  test("类注释给 description / summary / tags / jsDoc", () => {
    const { file, klass, method } = classOf(SOURCE);
    const model = reflectModel(
      [
        {
          file,
          docNode: (file.program["body"]?.[0] as Node) ?? klass,
          classNode: klass,
          exportName: "DemoService",
          serviceKey: "demoService",
          methods: [{ method: "read", node: method, typeNames: [] }],
        },
      ],
      new Map(),
    );
    const service = model.services[0];
    expect(service?.description).toBe("Host owner of the demo namespace. It answers one question.");
    expect(service?.summary).toBe("Host owner of the demo namespace.");
    expect(service?.jsDoc).toContain("Host owner of the demo namespace.");
    expect(service?.tags.map((tag) => tag.name)).toEqual(["typert", "param"]);
    expect(service?.tags[1]?.argument).toBe("ns");
    expect(service?.members[0]?.signature).toContain(
      "@Remote async read(ns: string): Promise<string>",
    );
    expect(service?.members[0]?.summary).toBe("Read one value.");
    expect(model.events).toEqual([]);
  });

  test("没有注释时留空而不是猜", () => {
    const { file, klass, method } = classOf(
      "export class X extends TypertRemoteService { @Remote read(): void {} }\n",
    );
    const model = reflectModel(
      [
        {
          file,
          docNode: klass,
          classNode: klass,
          exportName: "X",
          serviceKey: "x",
          methods: [{ method: "read", node: method, typeNames: [] }],
        },
      ],
      new Map(),
    );
    expect(model.services[0]?.description).toBe("");
    expect(model.services[0]?.tags).toEqual([]);
  });
});
