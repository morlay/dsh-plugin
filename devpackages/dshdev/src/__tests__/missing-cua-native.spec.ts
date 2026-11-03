import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertCuaNativePayload, missingCuaNativeError } from "../cli/prepare-seed.ts";

const CUA = "@deepseek-ai/dsh-experimental-cua-macos";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

// 闭包的形状（pnpm deploy 的 `.pnpm` 布局）：只要包名与目录层级对，校验就该认出它。
async function closure(withReceipt: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dshdev-cua-"));
  dirs.push(root);
  const packageRoot = join(
    root,
    "node_modules",
    ".pnpm",
    `${CUA.replace("@", "").replace("/", "+")}@1.0.0`,
    "node_modules",
    ...CUA.split("/"),
  );
  const receipt = join(packageRoot, "native", "bin", "darwin-arm64", "current.json");
  await mkdir(join(packageRoot, "native", "bin", "darwin-arm64"), { recursive: true });
  if (withReceipt) await writeFile(receipt, '{"bundle":"x"}\n');
  return join(root, "node_modules");
}

function message(): string {
  return missingCuaNativeError("/repo/" + CUA, "darwin-arm64").message;
}

describe("desktop seed 的 CUA native 载荷", () => {
  // 归因要写清：缺的不是依赖，是**发布产物**（上游 .gitignore 了 native/bin），别让人去查 pnpm deploy。
  it("缺 receipt 时报错，并指出路径与怎么补", async () => {
    const modulesDir = await closure(false);
    let error: Error | undefined;
    try {
      await assertCuaNativePayload(modulesDir, "darwin", "arm64");
    } catch (cause: unknown) {
      error = cause as Error;
    }
    if (error === undefined) throw new Error("缺载荷时应当报错");
    expect(error.message).toContain(join("native", "bin", "darwin-arm64", "current.json"));
    expect(error.message).toContain(
      "pnpm --filter @deepseek-ai/dsh-experimental-cua-macos run build:native",
    );
    expect(error.message).toContain("gitignores native/bin");
  });

  it("有 receipt 时放行", async () => {
    const modulesDir = await closure(true);
    await expect(assertCuaNativePayload(modulesDir, "darwin", "arm64")).resolves.toBeUndefined();
  });

  it("非 macOS 不看，闭包里没这一行也不管", async () => {
    const modulesDir = await closure(false);
    await expect(assertCuaNativePayload(modulesDir, "linux", "x64")).resolves.toBeUndefined();
    await expect(
      assertCuaNativePayload(join(modulesDir, "..", "empty"), "darwin", "arm64"),
    ).resolves.toBeUndefined();
  });

  it("消息里点名发布产物与构建命令", () => {
    expect(message()).toContain(`${CUA}/native/bin/darwin-arm64/current.json`);
  });
});
