// `prebundleAll` 的一条硬约束：**同一个包只构建一次**。
//
// 为什么必须分组：`@shikijs/langs` 的 60 个语言包若各成一条独立目标、各调一次 `bundlePackage`，
// 每次产出的 `.files.json` 只含当次那一个出口，后一次就会把前一次**覆盖**掉——盘上 60 个 `*.js`
// 都在、清单里却只剩最后一个；60 次构建也把时间拖到不可接受。
//
// 判据：同包同版本同清单的出口并成一组，一次构建把全部出口作为多 entry 交给打包器。
import { describe, expect, it } from "vitest";
import { groupTargetsByPackage, type PrebundleTarget } from "../prebundle.ts";

/** 造一条目标（只有分组用得上的字段有值）。 */
function targetOf(name: string, exportName: string, manifestOf?: string): PrebundleTarget {
  return {
    name,
    version: "1.0.0",
    exportName,
    entry: `/virtual/${name}/${exportName}.js`,
    ...(manifestOf === undefined ? {} : { manifestOf }),
  };
}

describe("groupTargetsByPackage", () => {
  it("同包的多个出口并成一组（60 个语言包不是 60 次构建）", () => {
    const languages = ["typescript", "json", "python"].map((name) =>
      targetOf("@shikijs/langs", name),
    );
    const groups = groupTargetsByPackage([targetOf("shiki", "core"), ...languages]);
    expect(groups).toHaveLength(2);
    const langs = groups.find((group) => group.targets[0]?.name === "@shikijs/langs");
    expect(langs?.targets.map((target) => target.exportName)).toEqual([
      "typescript",
      "json",
      "python",
    ]);
  });

  it("同名同版本但清单不同的**两份实体**不合并（pnpm 严格布局下会同时存在）", () => {
    const groups = groupTargetsByPackage([
      targetOf("react", "index", "/a/node_modules/react/package.json"),
      targetOf("react", "index", "/b/node_modules/react/package.json"),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("组内保持清单顺序（同包内我的出口顺序不被重排）", () => {
    const groups = groupTargetsByPackage([targetOf("shiki", "core"), targetOf("shiki", "index")]);
    expect(groups[0]?.targets.map((target) => target.exportName)).toEqual(["core", "index"]);
  });
});
