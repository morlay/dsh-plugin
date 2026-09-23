/**
 * 壳产物的依赖边界：`app.asar` 里只有壳自己的字节（`@local/*` 与 `@morlay/dsh-desktop-host` 内联进来），
 * 上游包一律留在产物外。所以壳入口可达的模块图里**不允许**出现上游裸引用——它们能通过类型检查、能被
 * tsdown 打出裸 `import`，但装进 `app.asar` 后解析不到，只在真机启动时炸
 * （2026-09-22：`seed.ts` 里 import 一个上游常量 → 启动即 `ERR_MODULE_NOT_FOUND`）。
 *
 * 这条边界是构建配置（`tsdown.config.ts` 的 `deps`）与源码的共同事实，因此在这里守：
 * 从壳入口出发沿相对 import 遍历，收集每个裸说明符，逐个核对白名单。
 */
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/** 装进 `app.asar` 的入口：壳主进程与 preload。 */
const SHELL_ENTRIES = ["src/index.ts", "src/preload-app.ts"];

/** 壳产物里能解析到的裸说明符：node 内建、Electron 自带、内联进来的本地包。 */
const ALLOWED = [/^node:/u, /^electron$/u, /^@local\//u, /^@morlay\/dsh-desktop-host(?:\/|$)/u];

/** Type-only import 不留运行时字节，不在这条边界里。 */
function withoutTypeImports(text: string): string {
  return text.replace(/(?:^|\n)\s*import\s+type[\s\S]*?from\s*["'][^"']+["']/gu, "\n");
}

function specifiersOf(text: string): string[] {
  const source = withoutTypeImports(text);
  const found: string[] = [];
  const from = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/gu;
  const sideEffect = /(?:^|\n)\s*import\s*["']([^"']+)["']/gu;
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;
  for (const pattern of [from, sideEffect, dynamic]) {
    for (const match of source.matchAll(pattern)) found.push(match[1] ?? "");
  }
  return found.filter((specifier) => specifier !== "");
}

describe("shell bundle dependency boundary", () => {
  it("keeps the shell's module graph free of packages app.asar cannot resolve", async () => {
    const visited = new Set<string>();
    const offenders: string[] = [];
    const queue = SHELL_ENTRIES.map((entry) => resolve(ROOT, entry));

    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (visited.has(file)) continue;
      visited.add(file);
      for (const specifier of specifiersOf(await readFile(file, "utf8"))) {
        if (specifier.startsWith(".")) {
          queue.push(resolve(dirname(file), specifier));
          continue;
        }
        if (ALLOWED.some((pattern) => pattern.test(specifier))) continue;
        offenders.push(`${relative(ROOT, file)} → ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
