import { glob, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists, requireWorkspaceEnv, runInherited } from "./common.ts";

// 对上游应用本地 patch（前置：在 sync 的干净基线上运行）：先按 `DEEPSEEK_HARNESS_EXCLUDE` 裁剪包目录
// （删目录 + 从全部 tsconfig*.json 移除其 path 行），再执行 `<workspace 根>/patches/steps.json` 的步骤
// （`rm` / `text` / `git` / `exports`；env 名与路径约定见 `SKILL.md` 的表）。任一失败即失败，不跳过；可从任意目录执行。
//
// `exports` 步骤是**生成式**改写：把上游各包 `exports` 里指向 `lib/` 的目标改成对应的 `src` 源文件，
// 使开发与桌面 dev 形态直接消费源码（决策见 `.agents/adrs/20261010-开发与桌面消费上游源码面而非lib产物.md`）。
// 它不存 diff——上游新增出口时自动适配，只在"本该映射却找不到源"时报错。

type Step =
  | { type: "rm"; path: string }
  | { type: "rm"; glob: string }
  | { type: "text"; file: string; pattern: string; flags?: string; to?: string }
  | { type: "git"; patch: string }
  | { type: "exports" }
  | { type: "typert" };

// 出口名 ≠ 源文件名：这些出口的目标要按包显式指定（`lib→src` 同构规则推不出来）。
// typert 分析要求每个 export 解析到**存在的**源文件，未映射的出口（其 `lib/` 目标已被移走）会让生成失败。
const EXPLICIT_SRC_EXPORTS: Record<string, Record<string, string>> = {
  "@deepseek-ai/dsh-app-boot": {
    "./worker/profile-resolution-bootstrap": "./src/profile-resolution/worker-bootstrap.ts",
  },
  "@deepseek-ai/dsh-client-ui-theme": { "./brand-font.css": "./src/styles/brand-font.css" },
  "@deepseek-ai/dsh-host-directory-picker-native": { "./worker": "./src/win32-dialog-worker.ts" },
  "@deepseek-ai/dsh-subprocess-local": { "./runner": "./src/bin.ts" },
};

// 生成物出口：目标是 `typert` 步骤产出的 `.ts`（不是 `lib/*.js`），因此按显式映射改指，
// 不走「lib→src 同构」规则。生成器的强制契约（`workspace.ts` 的 validateExport）期望 lib 形态，
// 而本仓库的生成步骤直接编排 analyzer/emitter、不调用它（见 `generateTypertArtifacts`）。
const GENERATED_EXPORTS: Record<string, string> = {
  "./typert": "./lib/typert.host.ts",
  "./client/typert": "./lib/typert.client.ts",
  "./remote": "./lib/typert.remote-client.ts",
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

async function rewriteExports(dir: string): Promise<void> {
  const unmapped: string[] = [];
  const touched: string[] = [];
  let addedSrcWildcard = 0;
  let filesRewritten = 0;
  for (const pkgDir of await packageDirs(dir)) {
    const manifestPath = join(pkgDir, "package.json");
    if (!(await pathExists(manifestPath))) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      exports?: unknown;
      main?: unknown;
      types?: unknown;
      files?: unknown;
      name?: string;
    };
    const exportsField = manifest.exports;
    if (exportsField === undefined || exportsField === null || typeof exportsField !== "object")
      continue;
    const shortName = (manifest.name ?? pkgDir).replace("@deepseek-ai/", "");
    let changed = false;

    for (const [exportName, value] of Object.entries(exportsField as Record<string, unknown>)) {
      const generated = GENERATED_EXPORTS[exportName];
      if (generated !== undefined) {
        (exportsField as Record<string, unknown>)[exportName] = {
          types: generated,
          default: generated,
        };
        changed = true;
        continue;
      }
      const explicit = EXPLICIT_SRC_EXPORTS[manifest.name ?? ""]?.[exportName];
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

    if (changed) {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      touched.push(shortName);
    }
  }
  console.log(
    `[patch] exports -> src: ${touched.length} 个包改写，${addedSrcWildcard} 个包补 ./src/*，` +
      `${filesRewritten} 个包的 files 改指源码面`,
  );
  if (unmapped.length > 0) {
    const unique = [...new Set(unmapped)];
    console.log(`[patch] exports 未映射 ${unique.length} 条（保持 lib 形态）:`);
    for (const line of unique.slice(0, 20)) console.log(`  - ${line}`);
    if (unique.length > 20) console.log(`  ... 其余 ${unique.length - 20} 条`);
  }
}

// 生成 typert 产物为 `.ts`：开发与桌面 dev 形态不再构建上游，`./typert` 与 `./remote` 出口必须落在
// 源码面能直接加载的文件上。这里直接编排 upstream 的 analyzer/emitter 而**不**调用
// `WorkspaceTypertGenerator.generate`——后者带 lib 形态的强制契约校验（`workspace.ts` 的 validateExport）。
// 产物：`lib/typert.<face>.ts`（运行时值）与 `lib/typert.remote-client.ts`（运行时值 + `declare module` 类型增强）。
async function generateTypertArtifacts(dir: string): Promise<void> {
  const entry = pathToFileURL(join(dir, "packages", "typert", "generator", "src", "index.ts")).href;
  const generator = (await import(entry)) as {
    WorkspaceCaches: new () => object;
    WorkspaceAnalyzer: new (options: Record<string, unknown>) => {
      discoverPackages(): { package: string }[];
      analyze(): { faces: readonly { packages: readonly { name: string; root: string }[] }[] };
    };
    FaceModelEmitter: new (face: unknown) => {
      emit(packageName: string): {
        face: string;
        js: string;
        remote?: { js: string; dts: string };
      };
    };
  };
  const caches = new generator.WorkspaceCaches();
  const discovered = new generator.WorkspaceAnalyzer({ root: dir, caches }).discoverPackages();
  const packages = discovered.map((candidate) => candidate.package);
  if (packages.length === 0) {
    console.log("[patch] typert: 没有发现贡献者包，跳过");
    return;
  }
  console.log(`[patch] typert: 分析 ${packages.length} 个包…`);
  const workspace = new generator.WorkspaceAnalyzer({
    root: dir,
    packages,
    caches,
    checkDiagnostics: false,
  }).analyze();
  let artifacts = 0;
  let remotes = 0;
  for (const face of workspace.faces) {
    const emitter = new generator.FaceModelEmitter(face);
    for (const packageModel of face.packages) {
      const artifact = emitter.emit(packageModel.name);
      const outDir = join(dir, packageModel.root, "lib");
      await mkdir(outDir, { recursive: true });
      // `js` 是运行时值；`dts` 是声明。合成一份 `.ts` 时：
      // - 值声明带上原声明的类型（`TYPERT` 保持 unknown，与上游「不让业务包依赖运行时注册表」一致）；
      // - 丢掉 dts 里与值重名的 `export declare const`、重复的 `export default` 与失效的 sourceMappingURL；
      // - 保留 `import type` 与 `declare module`（remote 的类型增强靠它）。
      const hostTs = artifact.js.replace(
        /^export const TYPERT = \{$/mu,
        "export const TYPERT: unknown = {",
      );
      await writeFile(join(outDir, `typert.${artifact.face}.ts`), hostTs);
      if (artifact.remote !== undefined) {
        const withType = artifact.remote.js.replace(
          /^export const TYPERT_REMOTE = \{$/mu,
          "export const TYPERT_REMOTE: TypertRemoteContribution = {",
        );
        const enhancement = artifact.remote.dts
          .split("\n")
          .filter(
            (line) =>
              !line.startsWith("export declare const TYPERT_REMOTE") &&
              !line.startsWith("export default ") &&
              !line.startsWith("//# sourceMappingURL"),
          )
          .join("\n");
        await writeFile(join(outDir, "typert.remote-client.ts"), `${withType}\n${enhancement}`);
        remotes += 1;
      }
      artifacts += 1;
    }
  }
  console.log(`[patch] typert: 生成 ${artifacts} 份 face 产物（其中 ${remotes} 份 remote-client）`);
}

async function main(): Promise<void> {
  const { value: dirValue, root } = await requireWorkspaceEnv("DEEPSEEK_HARNESS_DIR");
  const dir = resolve(root, dirValue);
  const patchesRoot = process.env.DEEPSEEK_HARNESS_PATCHES
    ? resolve(root, process.env.DEEPSEEK_HARNESS_PATCHES)
    : join(root, "patches");
  const stepsPath = process.env.DEEPSEEK_HARNESS_STEPS ?? join(patchesRoot, "steps.json");
  const exclude =
    process.env.DEEPSEEK_HARNESS_EXCLUDE?.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0) ?? [];

  if (!(await pathExists(dir)) || !(await pathExists(join(dir, ".git")))) {
    console.error(`上游目录不存在或非 git 仓库: ${dir}（先跑 sync）`);
    process.exit(1);
  }

  // ---- 步骤 0：DEEPSEEK_HARNESS_EXCLUDE 裁剪（先于 steps.json）----
  async function tsconfigFiles(): Promise<string[]> {
    const found: string[] = [];
    async function walk(dirPath: string): Promise<void> {
      if (!(await pathExists(dirPath))) return;
      for (const entry of await readdir(dirPath, { withFileTypes: true })) {
        const full = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          await walk(full);
        } else if (entry.name.startsWith("tsconfig") && entry.name.endsWith(".json")) {
          found.push(full);
        }
      }
    }
    await walk(dir);
    return found;
  }

  for (const target of exclude) {
    const abs = join(dir, target);
    if (await pathExists(abs)) {
      console.log(`[exclude] rm ${target}`);
      await rm(abs, { recursive: true, force: true });
    } else {
      console.warn(`[exclude] 不存在，跳过: ${target}`);
    }
    // 从全部 tsconfig*.json 移除引用该目录的 path 行（形如 { "path": "./packages/..." }）
    const esc = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ref = new RegExp(`^\\s*\\{?\\s*"path":\\s*"[^"]*${esc}"\\s*,?\\s*\\}?\\s*,?$`, "m");
    for (const file of await tsconfigFiles()) {
      const content = await readFile(file, "utf8");
      const next = content.replace(ref, "");
      if (next !== content) {
        console.log(`[exclude] tsconfig 移除引用: ${file.replace(dir + "/", "")}`);
        await writeFile(file, next);
      }
    }
  }

  // ---- 步骤 1+：patches/steps.json 步骤清单 ----
  if (!(await pathExists(stepsPath))) {
    console.error(`patch 步骤清单不存在: ${stepsPath}`);
    process.exit(1);
  }

  const steps: Step[] = JSON.parse(await readFile(stepsPath, "utf8"));
  for (const step of steps) {
    if (step.type === "rm") {
      if ("glob" in step) {
        // 按 glob 删（`rm` 的批量形态）：`fs.glob` 自带展开，不引入 glob 依赖；`node_modules` 永不进范围。
        let removed = 0;
        for await (const entry of glob(step.glob, {
          cwd: dir,
          exclude: (path) => path.includes("node_modules"),
        })) {
          await rm(join(dir, entry), { recursive: true, force: true });
          removed += 1;
        }
        console.log(`[patch] rm ${step.glob}（${removed} 项）`);
      } else {
        const target = join(dir, step.path);
        console.log(`[patch] rm ${step.path}`);
        await rm(target, { recursive: true, force: true });
      }
    } else if (step.type === "text") {
      const file = join(dir, step.file);
      if (!(await pathExists(file))) throw new Error(`patch 目标不存在: ${step.file}`);
      const content = await readFile(file, "utf8");
      const pattern = new RegExp(step.pattern, step.flags ?? "");
      if (!pattern.test(content)) throw new Error(`patch 正则未匹配: ${step.file}`);
      const next = content.replace(pattern, step.to ?? "");
      if (next === content) throw new Error(`patch 未产生变化: ${step.file}`);
      console.log(`[patch] text ${step.file}`);
      await writeFile(file, next);
    } else if (step.type === "git") {
      const patch = join(patchesRoot, step.patch);
      if (!(await pathExists(patch))) throw new Error(`patch 文件不存在: ${step.patch}`);
      console.log(`[patch] git apply ${step.patch}`);
      await runInherited("git", ["apply", patch], dir);
    } else if (step.type === "exports") {
      console.log(`[patch] exports -> src`);
      await rewriteExports(dir);
    } else if (step.type === "typert") {
      console.log(`[patch] typert -> lib/*.ts`);
      await generateTypertArtifacts(dir);
    } else {
      throw new Error(`未知 patch 步骤: ${JSON.stringify(step)}`);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
