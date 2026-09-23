import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { transformWithEsbuild } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

// 工作区内包的 client 半运行期是浏览器模块工厂（window.__ModuleLoader__），
// node 侧不可加载；按 exports 的 types 解析回 TS 源码。
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
      const types = typeof client === "object" ? client.types : undefined;
      if (typeof parsed.name !== "string" || typeof types !== "string") continue;
      aliases.push({ find: `${parsed.name}/client`, replacement: join(directory, types) });
    }
  }
  return aliases;
}

// 上游 typert 用**标准（TC39）装饰器**标记远程面（如 `@Remote('prompt')`）。上游包在测试里走已构建的
// lib，本仓库的 fork 包走源码入口，而 Vite 8 的默认转换器（oxc）不降级装饰器——原样执行时
// `node:vm` 编译报 SyntaxError。这里用 esbuild 预降级（实测可行；oxc 支持装饰器降级后可回退）。
// 范围限定 subagent 子树：只有那批源码带装饰器（YAGNI，需要时再扩）。
const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m;
const DECORATOR_SOURCES = /\/packages\/subagent\//;

function subagentStandardDecorators() {
  return {
    name: "dsh-subagent-standard-decorators",
    enforce: "pre" as const,
    async transform(code: string, id: string) {
      const file = id.split("?", 1)[0]!;
      if (
        !DECORATOR_SOURCES.test(file) ||
        !/\.[cm]?tsx?$/.test(file) ||
        !DECORATOR_SYNTAX.test(code)
      )
        return;
      const result = await transformWithEsbuild(code, file, {
        loader: file.endsWith("x") ? "tsx" : "ts",
        sourcemap: true,
        target: "es2024",
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig(async () => ({
  plugins: [subagentStandardDecorators()],
  resolve: { alias: await clientSourceAliases() },
  test: {
    include: [
      "packages/**/src/__tests__/**/*.spec.ts",
      "packages/**/src/__tests__/**/*.spec.tsx",
      // 共享工具链（@local/devkit）的测试与被它服务的包同形：src/__tests__/*.spec.ts。
      "devpackages/**/src/__tests__/**/*.spec.ts",
    ],
    exclude: ["**/node_modules/**", "target/**"],
  },
}));
