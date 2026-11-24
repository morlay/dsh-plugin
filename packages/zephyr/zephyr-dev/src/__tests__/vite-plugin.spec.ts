/**
 * 「谁能当文件」的判据：dev 形态下**只有当文件名单（`devFiles`，glob）点名的包**走 vite 逐文件
 * （`/@fs/…` + HMR），其余一律 prebundle（`@client-modules/…` 联邦产物）。
 *
 * 为什么判据是正向白名单：上游（`@deepseek-ai/*`）的 client 之间有循环 re-export，vite 的逐文件 ESM
 * 服务会报 `Detected cycle while resolving name`；把它们"漏进"文件链就整页起不来。反过来，漏配一个
 * 该改的包只是少了 HMR，页面照常。所以默认名单只放我们自己的包，其余默认 prebundle。
 */
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, test } from "@morlay/zephyr-app/testing";
import { dshClientPlugin } from "../internal/vite-plugin.ts";

/** 造一个包（清单 + 文件）。 */
async function makePackage(
  root: string,
  manifest: unknown,
  files: Record<string, string>,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify(manifest, null, 2), "utf8");
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
}

/** vite 的 `resolveId` 钩子在测试里的最小面（插件的钩子可以是对象，这里只取函数形态）。 */
type ResolveId = (
  source: string,
  importer?: string,
) => Promise<{ id: string; external?: boolean | "absolute" } | string | null | undefined>;

/** 插件的 `resolveId` 钩子（vite 的 hook 可以是对象形态，测试只按函数形态调用）。 */
function resolveIdOf(plugin: { resolveId?: unknown }): ResolveId {
  const hook = plugin.resolveId;
  if (typeof hook !== "function") throw new Error("插件没有 resolveId 钩子");
  return hook as ResolveId;
}

/**
 * 建一份 workspace 结构（软链布局与 pnpm 一致）。
 * @param work - 本用例的临时目录。
 * @returns 两个关键路径（import 方与行入口）。
 */
async function setupWorkspace(
  work: string,
): Promise<{ importer: string; workspaceRowEntry: string }> {
  let importer: string;
  let workspaceRowEntry: string;
  await writeFile(
    join(work, "package.json"),
    JSON.stringify({ name: "root", private: true }),
    "utf8",
  );
  importer = join(work, "apps", "app", "src", "client", "index.ts");
  await mkdir(dirname(importer), { recursive: true });
  await writeFile(importer, "export {};\n", "utf8");
  workspaceRowEntry = join(work, "packages", "plugin", "dev-row", "src", "client", "index.ts");

  // 我们自己的包：**当文件**（名单点名的那个）。
  await makePackage(
    join(work, "packages", "plugin", "dev-row"),
    {
      name: "@morlay/dev-row",
      version: "0.0.1",
      exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
    },
    { "src/index.ts": "export {};\n", "src/client/index.ts": "export {};\n" },
  );
  // 上游的包：源码也在仓库里（软链已解开后不含 node_modules），但**不当文件**。
  await makePackage(
    join(work, "packages", "upstream", "up-row"),
    {
      name: "@deepseek-ai/up-row",
      version: "0.0.1",
      exports: { ".": "./src/index.ts", "./client": "./src/client/index.ts" },
    },
    { "src/index.ts": "export {};\n", "src/client/index.ts": "export {};\n" },
  );
  // 三方：只当 prebundle。
  await makePackage(
    join(work, "packages", "third", "react"),
    { name: "react", version: "18.3.1", main: "index.js" },
    {
      "index.js": "module.exports = {};\n",
    },
  );

  // workspace 软链（pnpm 的布局：node_modules 里是软链，解析后是仓库内的真实路径）。
  for (const [link, target] of [
    ["@morlay/dev-row", join(work, "packages", "plugin", "dev-row")],
    ["@deepseek-ai/up-row", join(work, "packages", "upstream", "up-row")],
    ["react", join(work, "packages", "third", "react")],
  ] as const) {
    const path = join(work, "node_modules", link);
    await mkdir(dirname(path), { recursive: true });
    await symlink(target, path);
  }
  return { importer, workspaceRowEntry };
}

/**
 * 建插件：`depsUrl` 是个记调用次数的桩（prebundle 的唯一出口）。
 * @param work - 本用例的临时目录（`repoRoot`）。
 * @param devFiles - dev 文件名单。
 * @returns 插件与它的调用记录。
 */
function pluginWith(
  work: string,
  devFiles: readonly string[],
): { plugin: ReturnType<typeof dshClientPlugin>; calls: string[] } {
  const calls: string[] = [];
  const plugin = dshClientPlugin({
    repoRoot: work,
    devFiles,
    depsUrl: async (specifier: string) => {
      calls.push(specifier);
      return `fed:${specifier}`;
    },
  });
  return { plugin, calls };
}

describe("vite 插件：dev 的裸说明符归哪条链", () => {
  test("名单点名的包 → 源码文件（client 半），不进 prebundle", async ({ appEnv }) => {
    const work = appEnv.values.dataDir;
    const { importer, workspaceRowEntry } = await setupWorkspace(work);
    const { plugin, calls } = pluginWith(work, ["@morlay/*"]);
    const resolved = await resolveIdOf(plugin)("@morlay/dev-row", importer);
    // 按**真实路径**比：workspace 包在 node_modules 里是软链，解不解链都指向同一份源码。
    expect(await realpath(resolved as string)).toBe(await realpath(workspaceRowEntry));
    expect(calls).toEqual([]);
  });

  test("仓库里但没点名的包（上游）→ prebundle，哪怕它的源码就在仓库内", async ({ appEnv }) => {
    const work = appEnv.values.dataDir;
    const { importer } = await setupWorkspace(work);
    const { plugin, calls } = pluginWith(work, ["@morlay/*"]);
    await expect(resolveIdOf(plugin)("@deepseek-ai/up-row", importer)).resolves.toEqual({
      id: "fed:@deepseek-ai/up-row",
      external: true,
    });
    expect(calls).toEqual(["@deepseek-ai/up-row"]);
  });

  test("三方 → prebundle", async ({ appEnv }) => {
    const work = appEnv.values.dataDir;
    const { importer } = await setupWorkspace(work);
    const { plugin } = pluginWith(work, ["@morlay/*"]);
    await expect(resolveIdOf(plugin)("react", importer)).resolves.toEqual({
      id: "fed:react",
      external: true,
    });
  });

  test("空名单 → 所有包都 prebundle", async ({ appEnv }) => {
    const work = appEnv.values.dataDir;
    const { importer } = await setupWorkspace(work);
    const { plugin } = pluginWith(work, []);
    await expect(resolveIdOf(plugin)("@morlay/dev-row", importer)).resolves.toEqual({
      id: "fed:@morlay/dev-row",
      external: true,
    });
  });
});
