import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { standardDecoratorsPlugin } from "@local/devkit";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

// 工作区内包的 client 半运行期是浏览器模块工厂（window.__ModuleLoader__），
// node 侧不可加载；按 exports 里指源码的那个出口解析回 TS（开发态就是一条字符串）。
async function clientSourceAliases(): Promise<{ find: string; replacement: string }[]> {
  const aliases: { find: string; replacement: string }[] = [];
  const packagesDir = join(root, "packages");
  for (const scope of await readdir(packagesDir, { withFileTypes: true })) {
    if (!scope.isDirectory()) continue;
    const scopeDir = join(packagesDir, scope.name);
    for (const entry of await readdir(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(scopeDir, entry.name);
      const manifest = join(directory, "package.json");
      let text: string;
      try {
        text = await readFile(manifest, "utf8");
      } catch {
        // 读取失败（多半是没有 package.json）等同于原先的 existsSync 判空：跳过。
        continue;
      }
      const parsed = JSON.parse(text) as {
        name?: unknown;
        exports?: Record<string, { types?: unknown } | string>;
      };
      const client = parsed.exports?.["./client"];
      const source =
        typeof client === "string"
          ? client
          : typeof client === "object" && client !== null
            ? client.types
            : undefined;
      if (typeof parsed.name !== "string" || typeof source !== "string") continue;
      aliases.push({ find: `${parsed.name}/client`, replacement: join(directory, source) });
    }
  }
  return aliases;
}

// 上游 typert 用**标准（TC39）装饰器**标记远程面（如 `@Remote('prompt')`）。上游包在测试里走已构建的
// lib，本仓库的 fork 包走源码入口，而 Vite 8 的默认转换器（oxc）不降级装饰器——原样执行时
// `node:vm` 编译报 SyntaxError。预转换的实现在 devkit（产物那边的 tsdown 用同一份）。
// 范围是**接管了带装饰器上游源码的包树**：`subagent`（上游那批远程面），以及 `profile`（`dsh-session-mode`
// 的 host 半自己开的远程面也带 `@Remote`）。新增同类包时按树的粒度加一个分支；`pre` 是必需的时机（默认时机太晚）。
const DECORATOR_SOURCES = /\/packages\/(?:subagent|profile)\//;

export default defineConfig(async () => ({
  plugins: [
    standardDecoratorsPlugin({ scope: DECORATOR_SOURCES, sourcemap: true, enforce: "pre" }),
  ],
  resolve: { alias: await clientSourceAliases() },
  test: {
    include: [
      // `packages/**` 含装配入口（`packages/bundles/*`，patch 与生成物同形、共享行内容一致的守护测试）。
      "packages/**/src/__tests__/**/*.spec.ts",
      "packages/**/src/__tests__/**/*.spec.tsx",
      // 共享工具链（@local/devkit）的测试与被它服务的包同形：src/__tests__/*.spec.ts。
      "devpackages/**/src/__tests__/**/*.spec.ts",
    ],
    exclude: ["**/node_modules/**", "target/**"],
  },
}));
