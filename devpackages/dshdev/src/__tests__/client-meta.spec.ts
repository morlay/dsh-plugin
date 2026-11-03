import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_BUILD_RECORD, readClientBuildEnvironment } from "../cli/client-meta.ts";

const dirs: string[] = [];
const saved = new Map<string, string | undefined>();
afterEach(async () => {
  const dir = saved.get("DEEPSEEK_HARNESS_DIR");
  if (dir === undefined) delete process.env["DEEPSEEK_HARNESS_DIR"];
  else process.env["DEEPSEEK_HARNESS_DIR"] = dir;
  saved.clear();
  for (const entry of dirs.splice(0)) await rm(entry, { recursive: true, force: true });
});

// workspace 形状的 fixture：`pnpm-workspace.yaml`（上溯到仓库根）+ vendor 里那份上游副本。
async function workspace(environment?: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dshdev-client-meta-"));
  dirs.push(root);
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  const app = join(root, "apps", "app");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "app", version: "0.2.2" }), "utf8");
  if (environment !== undefined) {
    const record = join(root, "vendor", "deepseek-harness", CLIENT_BUILD_RECORD);
    await mkdir(join(record, ".."), { recursive: true });
    await writeFile(record, JSON.stringify({ formatVersion: 1, environment }), "utf8");
  }
  return app;
}

describe("浏览器版本元数据（读上游产出的那份记录）", () => {
  it("原样读出 `DSH_CLIENT_*`（版本 / commit / dirty 都是上游定义的）", async () => {
    const app = await workspace({
      DSH_CLIENT_VERSION: "0.2.2-alpha.3",
      DSH_CLIENT_COMMIT_HASH: "05b1cae",
      DSH_CLIENT_GIT_DIRTY: "true",
      DSH_CLIENT_BUILD_PROFILE: "local",
    });
    expect(await readClientBuildEnvironment(app)).toEqual({
      DSH_CLIENT_VERSION: "0.2.2-alpha.3",
      DSH_CLIENT_COMMIT_HASH: "05b1cae",
      DSH_CLIENT_GIT_DIRTY: "true",
      DSH_CLIENT_BUILD_PROFILE: "local",
    });
  });

  it("记录不在、或不是 `DSH_CLIENT_*` 的键：给空对象（不挡流程）", async () => {
    expect(await readClientBuildEnvironment(await workspace())).toEqual({});
    const app = await workspace({ OTHER: "x", DSH_CLIENT_VERSION: "1.0.0" });
    expect(await readClientBuildEnvironment(app)).toEqual({ DSH_CLIENT_VERSION: "1.0.0" });
  });

  it("`DEEPSEEK_HARNESS_DIR` 指哪读哪", async () => {
    const app = await workspace();
    const root = join(app, "..", "..");
    const custom = join(root, "harness-copy");
    await mkdir(join(custom, ".dsh-build"), { recursive: true });
    await writeFile(
      join(custom, CLIENT_BUILD_RECORD),
      JSON.stringify({
        formatVersion: 1,
        environment: { DSH_CLIENT_VERSION: "9.9.9-alpha.1", DSH_CLIENT_COMMIT_HASH: "aaaaaaa" },
      }),
      "utf8",
    );
    saved.set("DEEPSEEK_HARNESS_DIR", process.env["DEEPSEEK_HARNESS_DIR"]);
    process.env["DEEPSEEK_HARNESS_DIR"] = "harness-copy";
    expect((await readClientBuildEnvironment(app))["DSH_CLIENT_VERSION"]).toBe("9.9.9-alpha.1");
  });
});
