import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "oxc-parser";
import { pathExists } from "./common.ts";

// `exports` 步骤：把上游各包 `exports` / `main` / `types` 里指向 `lib/` 的目标改写成对应的 `src`
// 源文件，并给缺 `"./src/*"` 出口的包补上——开发与桌面两种形态直接消费源码，不再需要构建上游
// （决策见 `.agents/adrs/20261010-开发与桌面消费上游源码面而非lib产物.md`）。
//
// 它是**生成式**步骤：不存 diff，上游新增出口自动适配，只在"本该映射却找不到源"时报出清单。
// 「`lib→src` 同构」推不出来的两类出口由步骤自己给（见 `vendor/steps.ts` 的 `exports` 步骤）：
// 生成物出口指向 `prebuild` 写出的 `.ts`，其余按包显式指定。

export type ExportsOptions = {
  /** 出口名 → 生成物文件（`typert` 步骤产出的 `.ts`，不是 `lib/*.js`）。 */
  generated: Record<string, string>;
  /** 包名 →（出口名 → 源文件）。 */
  explicit: Record<string, Record<string, string>>;
};

// 上游 workspace 成员目录（与 pnpm-workspace.yaml 的 globs 对齐）：group/pkg 两层、apps/vendor 一层、
// native 平台包一层。返回包目录（含 package.json 的那些）。
async function packageDirs(root: string): Promise<string[]> {
  const found: string[] = [];
  async function children(path: string): Promise<string[]> {
    try {
      return (await readdir(path, { withFileTypes: true }))
        .filter(
          (entry) => entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git",
        )
        .map((entry) => join(path, entry.name));
    } catch {
      return [];
    }
  }
  for (const group of await children(join(root, "packages"))) {
    for (const pkg of await children(group)) found.push(pkg);
  }
  for (const base of ["apps", "vendor", join("native", "system", "packages")]) {
    for (const pkg of await children(join(root, base))) found.push(pkg);
  }
  return found;
}

// `lib/*` 目标 → `src` 候选（按序探测，取第一个存在的）：覆盖上游的四种同构形态
// （`lib/index.js`、`lib/types/<x>.d.ts|.js`、`lib/types/<dir>/index.d.ts`、`lib/client.js`）。
function srcCandidates(target: string): string[] | undefined {
  // `main`/`types` 这类顶层字段不带 `./` 前缀（`lib/index.js`），`exports` 的目标带（`./lib/index.js`）。
  const normalized = target.startsWith("./") ? target.slice(2) : target;
  let rest: string;
  if (normalized.startsWith("lib/types/")) rest = normalized.slice("lib/types/".length);
  else if (normalized.startsWith("lib/")) rest = normalized.slice("lib/".length);
  else return undefined;
  // `.cjs` 与 `.js` 同源：dual ESM/CJS 包（schemastery）的条件分支在源码面是同一份 src。
  rest = rest
    .replace(/\.d\.ts$/, "")
    .replace(/\.d\.mts$/, "")
    .replace(/\.cjs$/, "")
    .replace(/\.mjs$/, "")
    .replace(/\.js$/, "");
  return [
    `./src/${rest}.ts`,
    `./src/${rest}.tsx`,
    `./src/${rest}/index.ts`,
    `./src/${rest}/index.tsx`,
  ];
}

// 映射一个出口目标；`undefined` 表示保持原样（非 lib 目标、白名单、或找不到源码）。
async function mapTarget(
  pkgDir: string,
  target: string,
  unmapped: string[],
  exportName: string,
): Promise<string | undefined> {
  const candidates = srcCandidates(target);
  if (candidates === undefined) return undefined;
  for (const candidate of candidates) {
    const path = join(pkgDir, candidate);
    try {
      if ((await stat(path)).isFile()) return candidate;
    } catch {
      // 候选不存在，继续
    }
  }
  unmapped.push(`${exportName} -> ${target}`);
  return undefined;
}

// `files` 是发布面的文件集，而 deploy 闭包（桌面 bundle）正是按它拷工作区副本。源码面下代码载体从 `lib/`
// 换成 `src`，不改这一项，闭包拷出来就是「清单在、代码没了」的空壳：app 能起来、host 起不来。
// 生成物仍落在 `lib/`（`typert` 步骤写的 `lib/typert.<face>.ts`，出口也指着它们），所以单独补一条。
// 「有 `lib/` 项」即整棵 `src` 入列——只列了 `src/main.c` 这类个别文件（native 的 entry 包）也算：缺
// `src/index.ts` 时那一条行的 import 直接失败。没有源码的包（例如只发 bin 的）保持原样。
async function rewriteFiles(pkgDir: string, manifest: { files?: unknown }): Promise<boolean> {
  const files = manifest.files;
  if (!Array.isArray(files)) return false;
  let sawLib = false;
  const kept: string[] = [];
  for (const entry of files) {
    if (typeof entry !== "string" || entry === "") continue;
    if (entry.startsWith("lib/")) {
      sawLib = true;
      continue;
    }
    kept.push(entry);
  }
  if (!sawLib || !(await pathExists(join(pkgDir, "src")))) return false;
  manifest.files = [...new Set([...kept, "src", "lib/typert.*"])];
  return true;
}

/** 相对 / 绝对 / 虚拟 / node 内置之外的裸说明符——**该由包管理器解析**的那些。 */
function isBareSpecifier(specifier: unknown): specifier is string {
  return (
    typeof specifier === "string" &&
    specifier !== "" &&
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("\0") &&
    !specifier.startsWith("node:")
  );
}

/** 说明符 → 包名：`@scope/name/sub` → `@scope/name`；`katex/dist/katex.min.css` → `katex`。 */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/**
 * 一棵源码树里 import 到的全部**包名**。
 *
 * 判据是 AST，不是正则：`import` / `export … from` / `import()` / `require()` / `import.meta.resolve()`
 * 五种写法都要认（相对路径之外的裸说明符**就是依赖**）。用 oxc 的解析器——它是这个包自己的依赖。
 */
async function importedPackagesOf(dir: string): Promise<Set<string>> {
  const found = new Set<string>();
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(entry.name)) continue;
      const { program } = await parse(child, await readFile(child, "utf8"));
      const visit = (node: unknown): void => {
        if (node === null || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }
        const record = node as Record<string, unknown>;
        if (
          record["type"] === "ImportDeclaration" ||
          record["type"] === "ExportNamedDeclaration" ||
          record["type"] === "ExportAllDeclaration" ||
          record["type"] === "ImportExpression"
        ) {
          const source = (record["source"] as { value?: unknown } | undefined)?.value;
          if (isBareSpecifier(source)) found.add(packageNameOf(source));
        }
        if (record["type"] === "CallExpression") {
          const callee = record["callee"] as { name?: unknown; property?: { name?: unknown } } | undefined;
          const first = (record["arguments"] as { value?: unknown }[] | undefined)?.[0];
          // `require("x")` 与 `import.meta.resolve("x")`（后者长成 `(<import.meta>).resolve(...)`）。
          if (
            (callee?.name === "require" || callee?.property?.name === "resolve") &&
            isBareSpecifier(first?.value)
          ) {
            found.add(packageNameOf(first.value));
          }
        }
        for (const value of Object.values(record)) visit(value);
      };
      visit(program);
    }
  };
  await walk(dir);
  return found;
}

/**
 * **deps 修复**：把上游放错段的运行期依赖挪回 `dependencies`，并**整段删掉 `devDependencies`**。
 *
 * 上游的规矩是"client 半的浏览器依赖（`clsx`、`shiki`、`katex` 这类）算 `devDependencies`，构建时由它
 * 自己的打包内联"，所以生产安装（`pnpm deploy --prod`）里没有它们。而本仓库这条链是**运行期现场打包**、
 * 真会 import 它们——闭包里因此缺一大片，只有到打包/浏览器才现形。做法：扫源码里出现的包名，凡在
 * `devDependencies` 里**被用到**的挪进 `dependencies`；然后删掉整个 `devDependencies`（我们的链不需要
 * 上游的测试与构建工具）。
 *
 * @param pkgDir - 包目录。
 * @param manifest - 该包的清单（就地改）。
 * @returns 本次挪了几个依赖；没有 `devDependencies` 时 undefined（不改）。
 */
async function rewriteDependencies(
  pkgDir: string,
  manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
): Promise<{ moved: number } | undefined> {
  const dev = manifest.devDependencies;
  if (dev === undefined) return undefined;
  const used = (await pathExists(join(pkgDir, "src")))
    ? await importedPackagesOf(join(pkgDir, "src"))
    : new Set<string>();
  const moved: Record<string, string> = {};
  for (const [name, range] of Object.entries(dev)) {
    if (used.has(name)) moved[name] = range;
  }
  delete manifest.devDependencies;
  if (Object.keys(moved).length > 0) {
    manifest.dependencies = { ...manifest.dependencies, ...moved };
  }
  return { moved: Object.keys(moved).length };
}

export async function rewriteExports(dir: string, options: ExportsOptions): Promise<void> {
  const unmapped: string[] = [];
  const touched: string[] = [];
  let addedSrcWildcard = 0;
  let filesRewritten = 0;
  let devDropped = 0;
  let dependenciesMoved = 0;
  for (const pkgDir of await packageDirs(dir)) {
    const manifestPath = join(pkgDir, "package.json");
    if (!(await pathExists(manifestPath))) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      exports?: unknown;
      main?: unknown;
      types?: unknown;
      files?: unknown;
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const exportsField = manifest.exports;
    if (exportsField === undefined || exportsField === null || typeof exportsField !== "object")
      continue;
    const shortName = (manifest.name ?? pkgDir).replace("@deepseek-ai/", "");
    let changed = false;

    for (const [exportName, value] of Object.entries(exportsField as Record<string, unknown>)) {
      const generated = options.generated[exportName];
      if (generated !== undefined) {
        (exportsField as Record<string, unknown>)[exportName] = {
          types: generated,
          default: generated,
        };
        changed = true;
        continue;
      }
      const explicit = options.explicit[manifest.name ?? ""]?.[exportName];
      if (explicit !== undefined) {
        // 保留原有条件键结构，只把字符串目标换成显式源文件（`.css` 出口没有 `types`）。
        const replaceTargets = (target: unknown): unknown => {
          if (typeof target === "string") return explicit;
          if (target !== null && typeof target === "object") {
            const next: Record<string, unknown> = {};
            for (const [key, inner] of Object.entries(target)) {
              next[key] = typeof inner === "string" ? explicit : inner;
            }
            return next;
          }
          return target;
        };
        (exportsField as Record<string, unknown>)[exportName] = replaceTargets(value);
        changed = true;
        continue;
      }
      if (typeof value === "string") {
        const mapped = await mapTarget(pkgDir, value, unmapped, `${shortName} ${exportName}`);
        if (mapped !== undefined) {
          (exportsField as Record<string, unknown>)[exportName] = mapped;
          changed = true;
        }
        continue;
      }
      if (value === null || typeof value !== "object") continue;
      // 条件对象：只有全部 lib 目标都能映射时才改写，避免出现一半 src 一半 lib 的出口。
      const conditions = value as Record<string, unknown>;
      const mappedConditions: Record<string, unknown> = { ...conditions };
      let allMapped = true;
      let anyMapped = false;
      for (const [condition, target] of Object.entries(conditions)) {
        if (typeof target !== "string") {
          allMapped = false;
          break;
        }
        const candidates = srcCandidates(target);
        if (candidates === undefined) {
          continue;
        }
        const mapped = await mapTarget(pkgDir, target, unmapped, `${shortName} ${exportName}`);
        if (mapped === undefined) {
          allMapped = false;
          break;
        }
        mappedConditions[condition] = mapped;
        anyMapped = true;
      }
      if (allMapped && anyMapped) {
        (exportsField as Record<string, unknown>)[exportName] = mappedConditions;
        changed = true;
      }
    }

    // 只改 `exports` 时，仍走 `main`/`types` 的解析路径（CJS require、按 main 装载的 loader）
    // 会指向已被移走的 `lib/`：同一份源码面要么全走 src，要么留一个静默失效的入口。
    for (const field of ["main", "types"] as const) {
      const target = manifest[field];
      if (typeof target !== "string") continue;
      const mapped = await mapTarget(pkgDir, target, unmapped, `${shortName} ${field}`);
      if (mapped !== undefined) {
        manifest[field] = mapped;
        changed = true;
      }
    }

    // 上游测试按源码子路径导入（`<pkg>/src/<x>.ts`）；没有该出口的包补上，保证改写后仍可显式走源码。
    // 只补已有 `exports` 的包：给没有 `exports` 的包添加会封死它原有的子路径解析。
    if (!Object.hasOwn(exportsField as Record<string, unknown>, "./src/*")) {
      (exportsField as Record<string, unknown>)["./src/*"] = "./src/*";
      changed = true;
      addedSrcWildcard += 1;
    }

    if (await rewriteFiles(pkgDir, manifest)) {
      changed = true;
      filesRewritten += 1;
    }

    const deps = await rewriteDependencies(pkgDir, manifest);
    if (deps !== undefined) {
      changed = true;
      devDropped += 1;
      dependenciesMoved += deps.moved;
    }

    if (changed) {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      touched.push(shortName);
    }
  }
  console.log(
    `[steps] exports -> src: ${touched.length} 个包改写，${addedSrcWildcard} 个包补 ./src/*，` +
      `${filesRewritten} 个包的 files 改指源码面，` +
      `${devDropped} 个包删了 devDependencies（其中挪回 dependencies ${dependenciesMoved} 条）`,
  );
  if (unmapped.length > 0) {
    const unique = [...new Set(unmapped)];
    console.log(`[steps] exports 未映射 ${unique.length} 条（保持 lib 形态）:`);
    for (const line of unique.slice(0, 20)) console.log(`  - ${line}`);
    if (unique.length > 20) console.log(`  ... 其余 ${unique.length - 20} 条`);
  }
}
