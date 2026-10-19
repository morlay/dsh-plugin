import { describe, expect, it } from "vitest";
import { parseHostInvocation } from "../invocation.ts";

// 两个入口（desktop 的 `index.ts`、web 的 `web.ts`）共用这一套参数：这是"形态之间唯一该不同的地方"
// 之外的全部输入——两形态从这里拿到的东西必须同形，否则"哪一层生效"又会两边不一致。
describe("宿主入口的参数（desktop / web 共用）", () => {
  it("取两格锚点、overlay、包通道与 `--` 之后的内层参数", () => {
    expect(
      parseHostInvocation("dsh desktop", [
        "--profile-dir",
        "/profiles/desktop",
        "--runtime-dir",
        "/runtime",
        "--patch",
        "/host/desktop.cordis.patch.yml",
        "--patch",
        "/extra.yml",
        "--pnpm",
        "/runtime/pnpm",
        "--node-bin",
        "/runtime/node/bin",
        "--",
        "--no-open",
      ]),
    ).toEqual({
      profileDir: "/profiles/desktop",
      runtimeDir: "/runtime",
      patches: ["/host/desktop.cordis.patch.yml", "/extra.yml"],
      pnpmEntry: "/runtime/pnpm",
      nodeBin: "/runtime/node/bin",
      inner: ["--no-open"],
    });
  });

  it("包通道与 overlay 都可省（dev 形态不传 pnpm 载荷）", () => {
    const invocation = parseHostInvocation("dsh desktop", [
      "--profile-dir",
      "/app",
      "--runtime-dir",
      "/store",
    ]);
    expect(invocation.pnpmEntry).toBeUndefined();
    expect(invocation.nodeBin).toBeUndefined();
    expect(invocation.patches).toEqual([]);
    expect(invocation.inner).toEqual([]);
  });

  it("缺锚点、缺值、参数不认识时都失败，且报出是哪个入口", () => {
    expect(() => parseHostInvocation("dsh desktop", [])).toThrow(/dsh desktop: .*--profile-dir/u);
    expect(() => parseHostInvocation("dsh desktop", ["--profile-dir", "/app"])).toThrow(
      /--runtime-dir/u,
    );
    expect(() =>
      parseHostInvocation("dsh desktop", ["--profile-dir", "/app", "--runtime-dir"]),
    ).toThrow(/needs a value/u);
    expect(() => parseHostInvocation("dsh web", ["--nope"])).toThrow(
      /dsh web: unknown argument "--nope"/u,
    );
  });
});
