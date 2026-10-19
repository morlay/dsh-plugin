// client 行的 loader 依赖（`package.json` 的 `dsh.client.inject`）从入口源码推导，不手写：
// 扫 client 入口的 `inject(Token)` / `inject.optional(Token)`，再用 Token 上声明的 `host`
// （提供该值的 client 插件包）反推。没有 `host` 的 Token（本仓库内联的 client 面）自然不入列。

import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const INJECT_CALL = /\binject(?:\.optional)?\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/gu;
const IMPORT_STATEMENT =
  /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/gu;
const RELATIVE_IMPORT = /^\./u;

interface ImportRef {
  readonly specifier: string;
  readonly imported: string;
}

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// 相对 import → 真实文件；包名返回 undefined（不跟进去）。
async function resolveRelative(specifier: string, fromFile: string): Promise<string | undefined> {
  if (!RELATIVE_IMPORT.test(specifier)) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

// 一份源码里的 import：本地名 → 来源（default / 具名）。
function importsOf(source: string): Map<string, ImportRef> {
  const imports = new Map<string, ImportRef>();
  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    const [, defaultName, named, specifier] = match;
    if (specifier === undefined) continue;
    if (defaultName !== undefined) imports.set(defaultName, { specifier, imported: "default" });
    for (const part of (named ?? "").split(",")) {
      const cleaned = part.trim().replace(/^type\s+/u, "");
      if (cleaned.length === 0) continue;
      const [imported, local] = cleaned.split(/\s+as\s+/u);
      if (imported === undefined || imported.length === 0) continue;
      imports.set(local?.trim() ?? imported, { specifier, imported });
    }
  }
  return imports;
}

/**
 * 从 client 入口推导 loader 需要先就位的 client 插件包。
 *
 * @param entry - client 入口的绝对路径。
 * @returns 排好序的包名；没有就返回空数组。
 */
export async function clientInjectOf(entry: string): Promise<readonly string[]> {
  const hosts = new Set<string>();
  const visited = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    const imports = importsOf(source);

    for (const ref of imports.values()) {
      const nested = await resolveRelative(ref.specifier, file);
      if (nested !== undefined) queue.push(nested);
    }
    for (const match of source.matchAll(INJECT_CALL)) {
      const local = match[1];
      if (local === undefined) continue;
      const ref = imports.get(local);
      if (ref === undefined || RELATIVE_IMPORT.test(ref.specifier)) continue;
      const module = (await import(ref.specifier)) as Record<string, unknown>;
      const host = (module[ref.imported] as { host?: unknown } | undefined)?.host;
      if (typeof host === "string" && host.length > 0) hosts.add(host);
    }
  }

  return [...hosts].sort();
}
