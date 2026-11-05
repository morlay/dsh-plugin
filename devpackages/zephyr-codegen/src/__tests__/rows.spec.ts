import { describe, expect, it } from "vitest";
import { defineModule } from "../meta.ts";
import { rowsOf } from "../rows.ts";

function withPackage<T extends Function>(cls: T, packageName: string): T {
  Object.defineProperty(cls, "packageName", { value: packageName });
  return cls;
}

class Alpha {}
class Beta {}
withPackage(Alpha, "@x/alpha");
withPackage(Beta, "@x/beta");

describe("insert 行来自 Provider", () => {
  it("只有一个 insert 块，顺序按 providers 声明", () => {
    class SimpleModule {}
    defineModule({ providers: [Alpha, Beta] })(SimpleModule);

    expect(rowsOf(SimpleModule)).toEqual([
      {
        insert: [
          { id: "alpha", name: "@x/alpha" },
          { id: "beta", name: "@x/beta" },
        ],
      },
    ]);
  });

  it("withConfig 形状把 config 落成顶层 config 行", () => {
    class Rdb {}
    withPackage(Rdb, "@x/rdb");
    class ConfiguredModule {}
    defineModule({
      providers: [{ provide: Rdb, useValue: { type: "sqlite" } }],
    })(ConfiguredModule);

    expect(rowsOf(ConfiguredModule)).toEqual([
      { insert: [{ id: "rdb", name: "@x/rdb" }] },
      { id: "rdb", config: { type: "sqlite" } },
    ]);
  });

  it("official row 的 config / disabled 落顶层行，按 providers 声明顺序", () => {
    class OfficialModule {}
    defineModule({
      providers: [
        { kind: "official-row", rowId: "web", config: { searchProvider: "ollama" } },
        { kind: "official-row", rowId: "fs-sandbox", disabled: true },
      ],
    })(OfficialModule);

    expect(rowsOf(OfficialModule)).toEqual([
      { id: "fs-sandbox", disabled: true },
      { id: "web", config: { searchProvider: "ollama" } },
    ]);
  });

  it("imports 深度优先，再排自己的 providers", () => {
    class InnerOne {}
    class InnerTwo {}
    class OuterOne {}
    withPackage(InnerOne, "@x/inner-one");
    withPackage(InnerTwo, "@x/inner-two");
    withPackage(OuterOne, "@x/outer-one");

    class InnerModule {}
    defineModule({ providers: [InnerOne, InnerTwo] })(InnerModule);
    class OuterModule {}
    defineModule({ imports: [InnerModule], providers: [OuterOne] })(OuterModule);

    expect(rowsOf(OuterModule)).toEqual([
      {
        insert: [
          { id: "inner-one", name: "@x/inner-one" },
          { id: "inner-two", name: "@x/inner-two" },
          { id: "outer-one", name: "@x/outer-one" },
        ],
      },
    ]);
  });

  it("providers 里的内嵌 Module 与 useModule 引用按声明位置展开", () => {
    class NestedOne {}
    class OtherOne {}
    withPackage(NestedOne, "@x/nested-one");
    withPackage(OtherOne, "@x/other-one");

    class NestedModule {}
    defineModule({ providers: [NestedOne] })(NestedModule);
    class OtherModule {}
    defineModule({ providers: [OtherOne] })(OtherModule);
    class HostModule {}
    defineModule({
      providers: [[Alpha], NestedModule, { useModule: OtherModule }],
    })(HostModule);

    expect(rowsOf(HostModule)).toEqual([
      {
        insert: [
          { id: "alpha", name: "@x/alpha" },
          { id: "nested-one", name: "@x/nested-one" },
          { id: "other-one", name: "@x/other-one" },
        ],
      },
    ]);
  });
});

describe("元数据缺口按错误暴露", () => {
  it("imports 里不是 Module 的类", () => {
    class NotAModule {}
    class BrokenModule {}
    defineModule({ imports: [NotAModule] })(BrokenModule);

    expect(() => rowsOf(BrokenModule)).toThrow(/"NotAModule" is not a module/);
  });

  it("multi contribution 还没有行表达", () => {
    class Multi {}
    withPackage(Multi, "@x/multi");
    class MultiModule {}
    defineModule({
      providers: [{ provide: Multi, useValue: {}, multi: true }],
    })(MultiModule);

    expect(() => rowsOf(MultiModule)).toThrow(/multi contribution/);
  });

  it("Provider 没有声明包名", () => {
    class NoPackage {}
    class NoPackageModule {}
    defineModule({ providers: [NoPackage] })(NoPackageModule);

    expect(() => rowsOf(NoPackageModule)).toThrow(/找不到所属的包/);
  });
});

describe("without/exclude 生成 disabled 行", () => {
  it("运行期剔除的 Provider 在 patch 里保留为 disabled 行", () => {
    class Base {}
    defineModule({ providers: [Alpha, Beta] })(Base);

    class Runtime {}
    defineModule({ imports: [Base], providers: [{ kind: "without", entry: Beta }] })(Runtime);

    expect(rowsOf(Runtime)).toEqual([
      {
        insert: [
          { id: "alpha", name: "@x/alpha" },
          { id: "beta", name: "@x/beta", disabled: true },
        ],
      },
    ]);
  });
});

describe("without 表达式", () => {
  it("带 disabled 表达式时只写 patch，不参与运行期剔除", () => {
    class Base {}
    defineModule({ providers: [Alpha] })(Base);
    class Runtime {}
    defineModule({
      imports: [Base],
      providers: [{ kind: "without", entry: Beta, disabled: { __jsExpr: "process.platform === 'win32'" } }],
    })(Runtime);

    expect(rowsOf(Runtime)).toEqual([
      {
        insert: [
          { id: "alpha", name: "@x/alpha" },
          { id: "beta", name: "@x/beta", disabled: { __jsExpr: "process.platform === 'win32'" } },
        ],
      },
    ]);
  });
});

describe("Module 覆盖 Provider", () => {
  it("后 Module 同 token 只生成一行，使用后者配置", () => {
    class First {}
    defineModule({ providers: [{ provide: Alpha, useValue: { value: 1 } }] })(First);
    class Second {}
    defineModule({
      imports: [First],
      providers: [{ provide: Alpha, useValue: { value: 2 } }],
    })(Second);

    expect(rowsOf(Second)).toEqual([
      { insert: [{ id: "alpha", name: "@x/alpha" }] },
      { id: "alpha", config: { value: 2 } },
    ]);
  });
});
