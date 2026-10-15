// **按需 vendored 的上游内部文件**。
//
// 上游那些"内部实现文件"（`src/<x>.ts`）不该被当成包边界的一部分——上游的 `exports` 里没有它们，我们也不该
// 要求上游把它们摊成出口（那会让我们的打包边界跟着乱：同一个包既按出口引、又按源码路径引）。所以我们**按需
// 把这些文件复制进自己包的 `src/vendor/<短名>/…`**，import 走包内相对路径；上游变了由 `upstream-sync vendor`
// 重新拉一次（`--check` 只报差异，进 CI 用）。
//
// 判据：**只有 src 侧（非测试）按上游内部路径 import 的**才在这里。测试按需自己引，不进快照。
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { UpstreamPaths } from "./common.js";
import { pathExists } from "./common.js";

/** 一组要复制到某个本地包里的上游文件。 */
export interface VendoredGroup {
  /** 本地包目录（相对 workspace 根）。 */
  readonly packageDir: string;
  /** 上游包名（`@deepseek-ai/<x>`）。 */
  readonly from: string;
  /** 上游包内相对 `src/` 的路径。 */
  readonly files: readonly string[];
}

/** 清单本体：一处写清"哪个本地包要上游哪几个文件"。 */
export const VENDORED: readonly VendoredGroup[] = [
  {
    packageDir: "packages/subagent/dsh-subagent",
    from: "@deepseek-ai/dsh-subagent",
    files: [
      "activation.ts",
      "archive-admission.ts",
      "assistant-output.ts",
      "catalog.ts",
      "child-agent.ts",
      "continuation-messages.ts",
      "control-types.ts",
      "control.ts",
      "depth.ts",
      "descriptor.ts",
      "error.ts",
      "internal.ts",
      "lifecycle.ts",
      "list-children.ts",
      "out-of-process.ts",
      "projection-types.ts",
      "projection.ts",
      "structured.ts",
      "types.ts",
    ],
  },
  {
    packageDir: "packages/session/ui-conversation-message-actions",
    from: "@deepseek-ai/dsh-client-ui-chat",
    files: ["client/chat/MessageIconActions.tsx"],
  },
];

/** 上游包名 → 短名（目录名）：`@deepseek-ai/dsh-x` → `dsh-x`。 */
export function shortNameOf(from: string): string {
  return from.slice(from.lastIndexOf("/") + 1);
}

/**
 * 一个 vendored 文件还要带上哪些上游兄弟文件：顺着它的**同包相对 import** 递归（`./x`、`../y`）。
 *
 * 清单里列的是"入口"，闭包由这里补全——不这么做的话拷过来的文件会引用到没拷的兄弟文件。
 * 指向上游包之外的相对 import（`../../../…`）不管：那越过了包边界，本就不该出现在包内。
 */
async function collectClosure(dir: string, entries: readonly string[]): Promise<Set<string>> {
  const files = new Set<string>(entries);
  const visit = async (file: string): Promise<void> => {
    const text = await readFile(join(dir, file), "utf8");
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/gu)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = normalize(join(dirname(file), specifier));
      if (files.has(resolved) || resolved.startsWith("..")) continue;
      if (!(await pathExists(join(dir, resolved)))) continue;
      files.add(resolved);
      await visit(resolved);
    }
  };
  for (const entry of entries) await visit(entry);
  return files;
}

/** 上游包名 → 它在 vendor 树里的目录（`packages/<group>/<pkg>` 用名字反查）。 */
async function upstreamPackageDir(paths: UpstreamPaths, from: string): Promise<string> {
  const root = join(paths.dir, "packages");
  for (const group of await readdir(root, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const groupDir = join(root, group.name);
    for (const pkg of await readdir(groupDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const manifest = join(groupDir, pkg.name, "package.json");
      if (!(await pathExists(manifest))) continue;
      const parsed = JSON.parse(await readFile(manifest, "utf8")) as { name?: string };
      if (parsed.name === from) return join(groupDir, pkg.name);
    }
  }
  throw new Error(`上游找不到包 ${from}`);
}

/** 一个文件的目标位置（相对 workspace 根）。 */
export function vendoredTarget(group: VendoredGroup, file: string): string {
  return join(group.packageDir, "src", "vendor", shortNameOf(group.from), file);
}

/**
 * 把清单里的上游文件复制进各本地包（内容变了才写）。
 *
 * @param paths - 上游路径（见 {@link UpstreamPaths}）。
 * @returns 实际写了几份。
 */
export async function syncVendoredFiles(paths: UpstreamPaths): Promise<number> {
  let written = 0;
  for (const group of VENDORED) {
    const sourceDir = join(await upstreamPackageDir(paths, group.from), "src");
    for (const file of await collectClosure(sourceDir, group.files)) {
      const content = await readFile(join(sourceDir, file), "utf8");
      const target = join(paths.root, vendoredTarget(group, file));
      const current = await readFile(target, "utf8").catch(() => undefined);
      if (current === content) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      written += 1;
    }
  }
  return written;
}

/**
 * 列出与上游不一致的 vendored 文件（本地缺了、或上游已变）。
 *
 * @param paths - 上游路径。
 * @returns 不一致的条目（相对 workspace 根的路径）。
 */
export async function vendoredDrift(paths: UpstreamPaths): Promise<string[]> {
  const drift: string[] = [];
  for (const group of VENDORED) {
    const sourceDir = join(await upstreamPackageDir(paths, group.from), "src");
    for (const file of await collectClosure(sourceDir, group.files)) {
      const content = await readFile(join(sourceDir, file), "utf8");
      const target = join(paths.root, vendoredTarget(group, file));
      const current = await readFile(target, "utf8").catch(() => undefined);
      if (current !== content) drift.push(vendoredTarget(group, file));
    }
  }
  return drift;
}
