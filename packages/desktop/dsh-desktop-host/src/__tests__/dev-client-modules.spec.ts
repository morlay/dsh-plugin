import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseFileAddress,
  resolveBareUrl,
  resolveRelativeUrl,
  transpileFile,
} from "../dev-client/modules.ts";

// 这一组用例钉住「逐文件 ESM 直出」的两条硬约定：裸导入必须改写成绝对 URL（浏览器没有包解析），
// 相对导入**不动**（URL 结构镜像文件结构，浏览器自己拼就对）。

async function fixture(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "dev-esm-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "src", "index.ts"),
    [
      `import { helper } from "./helper.ts";`,
      `import { Button } from "@morlay/dsh-client-ui-primitives/client";`,
      `export const value: number = helper() + 1;`,
      `export { Button };`,
      "",
    ].join("\n"),
  );
  await writeFile(join(dir, "src", "helper.ts"), "export const helper = (): number => 1;\n");
  return { dir, file: join(dir, "src", "index.ts") };
}

describe("逐文件 ESM 转译", () => {
  it("裸导入改写成绝对 URL，相对导入原样留着", async () => {
    const { dir, file } = await fixture();
    const rewritten: string[] = [];
    const code = await transpileFile({
      file,
      rewrite: async (specifier) => {
        rewritten.push(specifier);
        return specifier.startsWith(".")
          ? undefined
          : "/plugins/@morlay+dsh-client-ui-primitives/0.0.1/src/client/index.ts";
      },
    });
    // 相对导入不进改写（保持 `./helper.ts`），裸导入进改写并换成 URL。
    expect(rewritten).toContain("@morlay/dsh-client-ui-primitives/client");
    expect(code).toContain('"/plugins/@morlay+dsh-client-ui-primitives/0.0.1/src/client/index.ts"');
    expect(code).toContain('"./helper.ts"');
    // rolldown 会把声明与导出拆开（`const value = …` + `export { Button, value }`）。
    expect(code).toContain("const value = helper() + 1");
    void dir;
  });

  it("类型注解被转译掉（浏览器拿到的不是 TS）", async () => {
    const { file } = await fixture();
    const code = await transpileFile({ file, rewrite: async () => undefined });
    expect(code).not.toContain(": number");
  });

  it("相对导入能拼出同包同版本的 URL", async () => {
    const { dir, file } = await fixture();
    const url = await resolveRelativeUrl(
      { name: "@morlay/demo", version: "1.2.3", root: dir },
      file,
      "./helper.ts",
    );
    expect(url).toBe("/plugins/@morlay+demo/1.2.3/src/helper.ts");
  });

  it("裸导入按包清单的 exports 解析子路径（`./client` → `src/client/index.ts`）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dev-esm-pkg-"));
    await mkdir(join(dir, "src", "client"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "@morlay/demo",
        version: "2.0.0",
        exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
      })}\n`,
    );
    await writeFile(join(dir, "src", "client", "index.ts"), "export const x = 1;\n");
    await writeFile(join(dir, "src", "index.ts"), "export const y = 1;\n");
    // 出口名与文件名不同构，必须按清单解析。
    await expect(
      resolveBareUrl("@morlay/demo/client", join(dir, "src", "index.ts"), () =>
        join(dir, "src", "client", "index.ts"),
      ),
    ).resolves.toBe("/plugins/@morlay+demo/2.0.0/src/client/index.ts");
    // 模块表里没有的包：交给调用方（浏览器会报 404，比静默改写安全）。
    await expect(
      resolveBareUrl("@morlay/absent", join(dir, "src", "index.ts"), () => undefined),
    ).resolves.toBeUndefined();
  });

  it("按文件寻址：解析、包名转义与越界拒绝", () => {
    expect(parseFileAddress("/plugins/@morlay+demo/1.2.3/src/client/index.ts")).toEqual({
      name: "@morlay/demo",
      version: "1.2.3",
      filepath: "src/client/index.ts",
    });
    // combo 与模块表的行入口都不是这个形状，交回旧路由。
    expect(parseFileAddress("/plugins/??a/client.js,b/client.js&rev=1")).toBeUndefined();
    expect(parseFileAddress("/plugins/??")).toBeUndefined();
  });
});
