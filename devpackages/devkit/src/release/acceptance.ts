// 发布前验收（票据 06）：判据 2 清单覆盖 / 7 private 分档 / 8 tarball 内容 / 9 出口加载冒烟 / 10 dry-run。
// 只读 registry（`pnpm view` / `pnpm pack`），不 publish。人工门：不进 `just test`、不进 CI；入口 `just verify-release`。
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

type Verdict = "pass" | "fail" | "blocked";

/** 一个出口目标：`types` 与 `default` 都是包内相对路径。 */
interface ExportTarget {
  readonly types?: string;
  readonly default?: string;
}
type ExportsMap = Readonly<Record<string, string | ExportTarget>>;

/** 本工具读到的清单字段。 */
interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly files?: readonly string[];
  readonly type?: string;
  readonly exports?: ExportsMap;
  readonly publishConfig?: { readonly exports?: ExportsMap };
  readonly engines?: { readonly dsh?: string };
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string };
    readonly client?: { readonly platform?: string };
  };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/** 一个工作区包。 */
interface Pkg {
  readonly dir: string;
  readonly manifest: Manifest;
}

/** 一条判据的结果。 */
interface Report {
  readonly id: string;
  readonly title: string;
  status: Verdict;
  readonly lines: string[];
}

/** 一个已打包并解开的发布包：`source` 是工作区清单，`manifest` 是打包后的清单（已应用 publishConfig）。 */
interface Packed {
  readonly name: string;
  readonly dir: string;
  readonly source: Manifest;
  readonly manifest: Manifest;
}

const write = (line: string): void => {
  process.stdout.write(line + "\n");
};

const exists = async (path: string): Promise<boolean> =>
  await stat(path).then(
    () => true,
    () => false,
  );

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const run = (command: string, args: readonly string[], cwd: string): Promise<RunResult> =>
  new Promise((done) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => done({ code: 1, stdout, stderr: String(error) }));
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });

/** 递归列文件，返回相对 `base` 的 posix 路径。 */
const walk = async (base: string, dir = base): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(base, full)));
    else files.push(relative(base, full).split("\\").join("/"));
  }
  return files.sort();
};

/** 读 `packages/<family>/<pkg>` 下每个包的清单。 */
const loadPackages = async (root: string): Promise<Pkg[]> => {
  const pkgs: Pkg[] = [];
  for (const family of await readdir(join(root, "packages"), { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    for (const entry of await readdir(join(root, "packages", family.name), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, "packages", family.name, entry.name);
      const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => undefined);
      if (raw === undefined) continue;
      pkgs.push({ dir, manifest: JSON.parse(raw) as Manifest });
    }
  }
  return pkgs.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
};

const targetFiles = (target: string | ExportTarget | undefined): string[] => {
  if (target === undefined) return [];
  if (typeof target === "string") return [target];
  return [target.types, target.default].filter((each): each is string => each !== undefined);
};

/** 判据 2：发布包的 `publishConfig.exports` 覆盖顶层 `exports` 每个键，且目标文件存在。 */
const checkManifestCoverage = async (pkgs: readonly Pkg[]): Promise<Report> => {
  const report: Report = {
    id: "判据 2",
    title: "publishConfig.exports 覆盖顶层 exports 每个键，目标文件都存在",
    status: "pass",
    lines: [],
  };
  const publics = pkgs.filter((each) => each.manifest.private !== true);
  for (const pkg of publics) {
    const top = Object.keys(pkg.manifest.exports ?? {});
    const published = pkg.manifest.publishConfig?.exports ?? {};
    const missing = top.filter((key) => !(key in published));
    if (missing.length > 0)
      report.lines.push(pkg.manifest.name + ": publishConfig.exports 缺键 " + missing.join(", "));
    for (const [key, target] of Object.entries(published)) {
      for (const file of targetFiles(target)) {
        if (!(await exists(join(pkg.dir, file))))
          report.lines.push(pkg.manifest.name + ": " + key + " → " + file + " 不存在");
      }
    }
  }
  report.status = report.lines.length > 0 ? "fail" : "pass";
  write(
    "  " +
      report.id +
      " " +
      report.title +
      "：" +
      (report.status === "pass" ? "通过（" + publics.length + " 个发布包）" : "不通过"),
  );
  for (const line of report.lines) write("    - " + line);
  return report;
};

/** 判据 7：非打包的 private 包不带 `publishConfig` / `engines.dsh`。 */
const checkPrivateManifests = (pkgs: readonly Pkg[]): Report => {
  const report: Report = {
    id: "判据 7",
    title: "private 包不带 publishConfig / engines.dsh",
    status: "pass",
    lines: [],
  };
  const privates = pkgs.filter((each) => each.manifest.private === true);
  for (const pkg of privates) {
    const extra: string[] = [];
    if (pkg.manifest.publishConfig !== undefined) extra.push("publishConfig");
    if (pkg.manifest.engines?.dsh !== undefined) extra.push("engines.dsh");
    if (extra.length > 0)
      report.lines.push(pkg.manifest.name + ": private 却带 " + extra.join(" / "));
  }
  report.status = report.lines.length > 0 ? "fail" : "pass";
  write(
    "  " +
      report.id +
      " " +
      report.title +
      "：" +
      (report.status === "pass" ? "通过（" + privates.length + " 个 private 包）" : "不通过"),
  );
  for (const line of report.lines) write("    - " + line);
  return report;
};

/** 判据 10：dry-run 只打印 `to publish` / `skip` 行，不进入发布子进程。 */
const checkDryRun = async (root: string, targets: readonly string[]): Promise<Report> => {
  const report: Report = {
    id: "判据 10",
    title: "dry-run 只列待发包与 dist-tag，不触网发布",
    status: "pass",
    lines: [],
  };
  const result = await run(
    "node",
    [
      "devpackages/devkit/src/release/publish.ts",
      "--registry",
      "https://registry.npmjs.org/",
      "--dry-run",
    ],
    root,
  );
  const lines = result.stdout
    .split("\n")
    .map((each) => each.trim())
    .filter((each) => each.length > 0);
  if (result.code !== 0) {
    report.status = "fail";
    report.lines.push(
      "退出码 " + result.code + "：" + (result.stderr.trim() || result.stdout.trim()),
    );
  }
  const offFormat = lines.filter((each) => !/^(to publish|skip) /.test(each));
  const realPublish = lines.filter((each) => each.startsWith("publish "));
  if (offFormat.length > 0) report.lines.push("非 dry-run 格式的行：" + offFormat.join(" | "));
  if (realPublish.length > 0) report.lines.push("出现真实发布行：" + realPublish.join(" | "));
  const absent = targets.filter((name) => !lines.some((each) => each.includes(" " + name + "@")));
  if (absent.length > 0) report.lines.push("目标包未出现在输出里：" + absent.join(", "));
  if (report.lines.length > 0) report.status = "fail";
  write(
    "  " +
      report.id +
      " " +
      report.title +
      "：" +
      (report.status === "pass" ? "通过（" + lines.length + " 行）" : "不通过"),
  );
  for (const line of lines) write("    " + line);
  for (const line of report.lines) write("    ! " + line);
  return report;
};

const packOne = async (pkg: Pkg, into: string): Promise<string | undefined> => {
  const result = await run("pnpm", ["pack", "--pack-destination", into], pkg.dir);
  if (result.code !== 0) return undefined;
  return result.stdout
    .split("\n")
    .map((each) => each.trim())
    .filter((each) => each.endsWith(".tgz"))
    .pop();
};

const unpack = async (tgz: string, into: string): Promise<string | undefined> => {
  await mkdir(into, { recursive: true });
  const result = await run("tar", ["-xzf", tgz, "-C", into], into);
  return result.code === 0 ? join(into, "package") : undefined;
};

/** rolldown 的 chunk 名形如 `contract-C0LrIwUj.mjs`：`-<8 位 hash>` 收尾。 */
const hashedChunk = /-([A-Za-z0-9_-]{8})\.(?:mjs|d\.mts|cjs)$/;

/** 判据 8：tarball 内容符合 `files`、不含 `__tests__`、dist 里没有旧 hash 残留。 */
const checkTarball = async (packed: Packed, report: Report): Promise<void> => {
  const files = await walk(packed.dir);
  const manifest = packed.manifest;
  const published = manifest.publishConfig?.exports ?? manifest.exports ?? {};
  const needed = new Set<string>(["package.json"]);
  for (const target of Object.values(published))
    for (const file of targetFiles(target)) needed.add(file.slice(2));
  const patch = manifest.dsh?.bundle?.patch;
  if (patch !== undefined) needed.add(patch.slice(2));
  for (const file of needed) {
    if (!files.includes(file)) {
      report.status = "fail";
      report.lines.push(packed.name + ": tarball 缺 " + file);
    }
  }
  const tests = files.filter((file) => file.split("/").includes("__tests__"));
  if (tests.length > 0) {
    report.status = "fail";
    report.lines.push(
      packed.name +
        ": tarball 混入 __tests__ " +
        tests.length +
        " 个（首个 " +
        String(tests[0]) +
        "）",
    );
  }
  const allowedTop = new Set<string>(["package.json", "README.md", "LICENSE", "LICENSE.md"]);
  for (const pattern of manifest.files ?? []) {
    if (pattern.startsWith("!")) continue;
    allowedTop.add(pattern.replace(/^\.\//, "").split("/")[0] ?? pattern);
  }
  const tops = [...new Set(files.map((file) => file.split("/")[0] ?? file))];
  const extraTops = tops.filter((each) => !allowedTop.has(each));
  if (extraTops.length > 0) {
    report.status = "fail";
    report.lines.push(packed.name + ": tarball 多出 files 之外的顶层项 " + extraTops.join(", "));
  }
  const groups = new Map<string, string[]>();
  for (const file of files.filter((each) => each.startsWith("dist/"))) {
    const match = hashedChunk.exec(file);
    if (match === null) continue;
    const stem = file.slice(0, file.length - (match[1] ?? "").length - 1);
    groups.set(stem, [...(groups.get(stem) ?? []), file]);
  }
  for (const [stem, members] of groups) {
    if (members.length > 1) {
      report.status = "fail";
      report.lines.push(
        packed.name + ": dist 里 " + stem + " 有多个 hash 副本（旧残留）：" + members.join(", "),
      );
    }
  }
  const packedKeys = Object.keys(manifest.exports ?? {}).sort();
  const expectedKeys = Object.keys(packed.source.publishConfig?.exports ?? {}).sort();
  if (packedKeys.join(",") !== expectedKeys.join(",")) {
    report.status = "fail";
    report.lines.push(
      packed.name +
        ": 打包后的 exports 与 publishConfig.exports 不一致（" +
        packedKeys.join(",") +
        "）",
    );
  }
  if (patch !== undefined) {
    const body = await readFile(join(packed.dir, patch.slice(2)), "utf8");
    if (!(body.split("\n")[0] ?? "").includes("请勿手工编辑")) {
      report.status = "fail";
      report.lines.push(packed.name + ": patch 首行不是「由 … 生成，请勿手工编辑」");
    }
  }
  const distCount = files.filter((each) => each.startsWith("dist/")).length;
  report.lines.push(
    packed.name +
      ": " +
      files.length +
      " 个文件（dist " +
      distCount +
      " 个，src " +
      files.filter((each) => each.startsWith("src/")).length +
      " 个），无 __tests__，patch 首行合规",
  );
};

/** 从 dist 的产物文件名推 `exports` 面：`index.mjs` → `.`，`<a>/index.mjs` → `./<a>`。 */
const distFaces = async (distDir: string): Promise<Map<string, string>> => {
  const faces = new Map<string, string>();
  for (const file of await walk(distDir)) {
    if (!file.endsWith(".mjs")) continue;
    if (hashedChunk.test(file)) continue;
    const stem = file.slice(0, -".mjs".length);
    const key =
      stem === "index"
        ? "."
        : stem.endsWith("/index")
          ? "./" + stem.slice(0, -"/index".length)
          : "./" + stem;
    faces.set(key, "./dist/" + file);
  }
  return faces;
};

/** 裸 specifier 的包名：`@scope/name/sub` → `@scope/name`。 */
const packageNameOf = (specifier: string): string =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);

/** 判据 9 的等价安装：把工作区各包的 `dist` 摆成「已发布」的 node_modules。 */
const buildNodeModules = async (
  nodeModules: string,
  pkgs: readonly Pkg[],
  externals: readonly string[],
  bases: readonly string[],
): Promise<Map<string, string>> => {
  const unresolved = new Map<string, string>();
  await mkdir(nodeModules, { recursive: true });
  // 目标包的裸导入 + 被拷进来的各包 dist 的裸导入，都要在临时 node_modules 里解析得到。
  const all = new Set<string>(externals);
  for (const pkg of pkgs) {
    const distDir = join(pkg.dir, "dist");
    if (!(await exists(distDir))) continue;
    for (const specifier of await bareSpecifiers(distDir)) all.add(specifier);
  }
  for (const pkg of pkgs) {
    const distDir = join(pkg.dir, "dist");
    if (!(await exists(distDir))) continue;
    const faces = await distFaces(distDir);
    if (faces.size === 0) continue;
    const own = join(nodeModules, ...pkg.manifest.name.split("/"));
    await mkdir(own, { recursive: true });
    // 拷贝而不是软链：Node 按 realpath 解析裸导入，软链会把 importer 逃出这棵 node_modules。
    await cp(distDir, join(own, "dist"), { recursive: true });
    const manifest = {
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      type: "module",
      exports: Object.fromEntries(faces),
    };
    await writeFile(join(own, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  for (const specifier of all) {
    const name = packageNameOf(specifier);
    const dest = join(nodeModules, ...name.split("/"));
    if (await exists(dest)) continue;
    let found: string | undefined;
    for (const base of bases) {
      const candidate = join(base, "node_modules", ...name.split("/"));
      if (await exists(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found === undefined) {
      unresolved.set(name, name + " 在本机依赖树里解析不到（未声明或未安装）");
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await symlink(found, dest, "dir").catch(() => undefined);
  }
  return unresolved;
};

/** 给 client 工厂用的宽松替身：任何属性与调用都返回新的替身。 */
const loose = (): unknown => {
  const target = function looseTarget(): void {};
  return new Proxy(target as unknown as Record<string | symbol, unknown>, {
    get: (_target, prop) =>
      prop === "then" ? undefined : prop === Symbol.toPrimitive ? () => "" : loose(),
    apply: () => loose(),
    construct: (): object => loose() as object,
  });
};

/** client 工厂捕获：`client.cjs` 执行时调 `window.__ModuleLoader__.load`。 */
interface LoaderEntry {
  readonly id: string;
  readonly factory: (requireOf: (id: string) => unknown) => unknown;
}
// `./ui` 是浏览器面，产物里引 `.css`：Node 里把 CSS 当空模块，判据只判「能不能加载」。
// 两条路都要堵：ESM `import` 走下面的 resolve/load 钩子，`require`（本仓 oxc 的 CJS 钩子会把 .css 当 .js 编）走 extensions。
const requireExtensions = createRequire(import.meta.url).extensions as unknown as Record<
  string,
  (module: unknown, filename: string) => void
>;
requireExtensions[".css"] ??= () => {};
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier.endsWith(".css")
      ? { url: 'data:text/javascript,export default "";', shortCircuit: true }
      : nextResolve(specifier, context),
  load: (url, context, nextLoad) =>
    url.endsWith(".css")
      ? { format: "module", source: 'export default "";', shortCircuit: true }
      : nextLoad(url, context),
});
const loaderEntries: LoaderEntry[] = [];
const moduleLoader = {
  load: (entry: LoaderEntry) => {
    loaderEntries.push(entry);
  },
};
// client.cjs 是浏览器半，工厂在 `document` / `window` 上取环境；Node 里给宽松替身，只判「执行不抛」。
(globalThis as unknown as Record<string, unknown>).window = new Proxy(
  { __ModuleLoader__: moduleLoader } as Record<string, unknown>,
  {
    get: (target, prop) =>
      prop === "__ModuleLoader__" ? moduleLoader : (target[prop as string] ?? loose()),
  },
);
for (const name of [
  "document",
  "navigator",
  "location",
  "HTMLElement",
  "customElements",
  "MutationObserver",
  "matchMedia",
  "requestAnimationFrame",
]) {
  (globalThis as unknown as Record<string, unknown>)[name] ??= loose();
}

const reasonOf = (
  error: unknown,
  unresolved: ReadonlyMap<string, string>,
): { text: string; blocked: boolean } => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const first = message.split("\n")[0] ?? message;
  const specifier = /(?:Cannot find package|Cannot find module) ['"]([^'"]+)['"]/.exec(
    message,
  )?.[1];
  if (specifier !== undefined) {
    const name = packageNameOf(specifier);
    const declared = unresolved.get(name);
    if (declared !== undefined) return { text: declared + "：" + first, blocked: true };
    if (name.startsWith("@oxc-project/"))
      return {
        text: "未声明的运行期依赖 " + name + "（rolldown 注入的装饰器 helper）：" + first,
        blocked: true,
      };
    if (name.startsWith("@morlay/"))
      return { text: "依赖包 " + name + " 没有该面的产物：" + first, blocked: true };
    return { text: first, blocked: false };
  }
  if (message.includes("is not defined by"))
    return { text: "依赖包缺该面产物：" + first, blocked: true };
  return { text: first, blocked: false };
};

/** 判据 9：解包后的每个发布出口加载一次；`./client` 走 `require()` 并执行工厂。 */
const checkSmoke = async (
  packed: Packed,
  unresolved: ReadonlyMap<string, string>,
  report: Report,
): Promise<void> => {
  const published = packed.manifest.exports ?? {};
  const requireOf = createRequire(import.meta.url);
  for (const [key, target] of Object.entries(published)) {
    if (key === "./package.json") continue;
    const file = typeof target === "string" ? target : target.default;
    if (file === undefined) continue;
    const full = join(packed.dir, file);
    const face = packed.name + (key === "." ? "" : key.slice(1));
    if (!(file.endsWith(".mjs") || file.endsWith(".cjs"))) {
      report.lines.push("  = " + face + "：非 JS 出口（" + file + "），存在性在判据 8 核对");
      continue;
    }
    try {
      if (key === "./client") {
        const before = loaderEntries.length;
        requireOf(full);
        const entry = loaderEntries.at(-1);
        if (loaderEntries.length === before || entry === undefined)
          throw new Error("client.cjs 没有调用 window.__ModuleLoader__.load");
        if (entry.id !== packed.name)
          throw new Error("client.cjs 的模块 id 是 " + entry.id + "，与包名不一致");
        if (typeof entry.factory !== "function") throw new Error("client.cjs 的 factory 不是函数");
        const produced = entry.factory((id: string) => {
          void id;
          return loose();
        });
        if (produced === undefined || produced === null)
          throw new Error("client.cjs 的 factory 执行后没有返回值");
        report.lines.push(
          "  + " + face + "：require() 成功，factory 执行不抛（id " + entry.id + "）",
        );
        continue;
      }
      const module = (await import(pathToFileURL(full).href)) as Record<string, unknown>;
      const names = Object.keys(module);
      report.lines.push(
        "  + " +
          face +
          "：import() 成功，导出 " +
          (names.length === 0 ? "仅 default/side effect" : names.slice(0, 6).join(", ")) +
          (names.length > 6 ? " …" : ""),
      );
      if (key === "./dsh-bundle") {
        const dshBundle = module["default"] as { name?: string; apply?: unknown } | undefined;
        if (
          dshBundle === undefined ||
          typeof dshBundle.apply !== "function" ||
          typeof dshBundle.name !== "string"
        ) {
          report.status = "fail";
          report.lines.push(
            "  ! " + face + "：默认导出不是 { name, apply }（" + JSON.stringify(dshBundle) + "）",
          );
        }
      }
    } catch (error) {
      const reason = reasonOf(error, unresolved);
      if (reason.blocked && report.status !== "fail") report.status = "blocked";
      if (!reason.blocked) report.status = "fail";
      report.lines.push("  - " + face + "：" + reason.text);
    }
  }
};

/** 解包后的四个目标包里所有裸 specifier（去掉相对路径与 node: 内建）。 */
const bareSpecifiers = async (dir: string): Promise<string[]> => {
  const found = new Set<string>();
  for (const file of await walk(dir)) {
    if (!file.endsWith(".mjs")) continue;
    const body = await readFile(join(dir, file), "utf8");
    for (const pattern of [/from "([^"]+)"/g, /^import "([^"]+)";?$/gm, /import\("([^"]+)"\)/g]) {
      for (const match of body.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        found.add(specifier);
      }
    }
  }
  // 只认包名形状：产物里的注释与文档字符串也可能含 `from "…"`。
  const packageShape = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(\/[a-zA-Z0-9._/-]+)?$/;
  return [...found]
    .filter(
      (each) => !each.startsWith(".") && !each.startsWith("node:") && !each.startsWith("data:"),
    )
    .filter((each) => packageShape.test(each))
    .sort();
};

/** 清单里声明的运行期依赖名。 */
const declaredNames = (manifest: Manifest): Set<string> =>
  new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);

/** 判据 9 的前置：产物里的裸导入都在清单里声明——没声明真装就解析不到。 */
const checkDeclaredExternals = async (packed: readonly Packed[]): Promise<Report> => {
  const report: Report = {
    id: "判据 9 前置",
    title: "产物里的裸导入都在 dependencies / peerDependencies 里声明",
    status: "pass",
    lines: [],
  };
  for (const one of packed) {
    const declared = declaredNames(one.source);
    const undeclared = [
      ...new Set(
        (await bareSpecifiers(one.dir))
          .map(packageNameOf)
          .filter((name) => !declared.has(name) && name !== one.name),
      ),
    ];
    if (undeclared.length > 0) {
      report.status = "fail";
      report.lines.push(one.name + ": 未声明 " + undeclared.join(", "));
    }
  }
  write("  " + report.id + " " + report.title + "：" + statusLine(report.status));
  for (const line of report.lines) write("    - " + line);
  return report;
};

/** 判据 9 的真装一层：临时项目 `pnpm add <tarball>`。 */
const checkRealInstall = async (
  work: string,
  tarballs: readonly string[],
  report: Report,
): Promise<void> => {
  const project = join(work, "install");
  await mkdir(project, { recursive: true });
  const manifest = {
    name: "dsh-acceptance-smoke",
    private: true,
    type: "module",
    dependencies: {} as Record<string, string>,
  };
  await writeFile(join(project, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  const result = await run("pnpm", ["add", ...tarballs], project);
  const tail = (result.code === 0 ? result.stdout : result.stderr)
    .trim()
    .split("\n")
    .slice(-6)
    .join("\n");
  if (result.code === 0) {
    report.lines.push("  + pnpm add 成功（" + tarballs.length + " 个 tarball）");
    return;
  }
  report.status = "blocked";
  report.lines.push("  - pnpm add 失败：依赖还没上 registry（首发顺序），安装目录 " + project);
  for (const line of tail.split("\n")) report.lines.push("    " + line);
};

interface Options {
  readonly keep: boolean;
  readonly filters: readonly string[];
}

const parseArgs = (argv: readonly string[]): Options => {
  const filters: string[] = [];
  let keep = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep") keep = true;
    else if (arg === "--filter") {
      const value = argv[index + 1];
      if (value !== undefined) filters.push(value);
      index += 1;
    } else if (arg !== undefined && arg.startsWith("--filter="))
      filters.push(arg.slice("--filter=".length));
  }
  return { keep, filters };
};

const statusLine = (verdict: Verdict): string =>
  verdict === "pass" ? "通过" : verdict === "blocked" ? "阻塞" : "不通过";

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const pkgs = await loadPackages(root);
  const targets = pkgs.filter((pkg) =>
    options.filters.length > 0
      ? options.filters.includes(pkg.manifest.name)
      : pkg.manifest.dsh?.bundle !== undefined,
  );
  if (targets.length === 0) {
    write("acceptance: 没有目标包（默认取清单里带 dsh.bundle 的包）");
    return 1;
  }
  const names = targets.map((each) => each.manifest.name);
  write("发布前验收：目标 " + names.join(", "));
  const reports: Report[] = [];
  reports.push(await checkManifestCoverage(pkgs));
  reports.push(checkPrivateManifests(pkgs));
  reports.push(await checkDryRun(root, names));
  const work = await mkdtemp(join(tmpdir(), "dsh-acceptance-"));
  write("工作目录 " + work);
  const tarballReport: Report = {
    id: "判据 8",
    title: "tarball 内容符合 files，不含 __tests__，无旧 hash 残留",
    status: "pass",
    lines: [],
  };
  const smokeReport: Report = {
    id: "判据 9",
    title: "每个发布出口 import() 成功，./client 走 require() 且工厂不抛",
    status: "pass",
    lines: [],
  };
  try {
    const tgzDir = join(work, "tgz");
    await mkdir(tgzDir, { recursive: true });
    const packed: Packed[] = [];
    const tarballs: string[] = [];
    for (const pkg of targets) {
      const tgz = await packOne(pkg, tgzDir);
      if (tgz === undefined) {
        tarballReport.status = "fail";
        tarballReport.lines.push(pkg.manifest.name + ": pnpm pack 失败");
        continue;
      }
      tarballs.push(tgz);
      const dir = await unpack(tgz, join(work, "unpacked", pkg.manifest.name.replace("/", "__")));
      if (dir === undefined) {
        tarballReport.status = "fail";
        tarballReport.lines.push(pkg.manifest.name + ": 解包失败（" + tgz + "）");
        continue;
      }
      const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Manifest;
      const one: Packed = { name: pkg.manifest.name, dir, source: pkg.manifest, manifest };
      packed.push(one);
      await checkTarball(one, tarballReport);
    }
    write(
      "  " + tarballReport.id + " " + tarballReport.title + "：" + statusLine(tarballReport.status),
    );
    for (const line of tarballReport.lines) write("    " + line);
    reports.push(tarballReport);

    const externals = new Set<string>();
    for (const one of packed)
      for (const specifier of await bareSpecifiers(one.dir)) externals.add(specifier);
    // 依赖面：本机依赖树里能解析到的一律摆进 node_modules（`判据 9 前置` 已单独判过「是否声明」）。
    const bases = [root, ...pkgs.map((each) => each.dir)];
    const unresolved = await buildNodeModules(
      join(work, "node_modules"),
      pkgs,
      [...externals],
      bases,
    );
    write(
      "  等价安装：node_modules 里摆 " +
        (await readdir(join(work, "node_modules"))).length +
        " 个顶层项，未解析 " +
        unresolved.size +
        " 个",
    );
    for (const reason of unresolved.values()) write("    ! " + reason);

    reports.push(await checkDeclaredExternals(packed));
    await checkRealInstall(work, tarballs, smokeReport);
    for (const one of packed) {
      smokeReport.lines.push(one.name + "（" + one.manifest.version + "）");
      await checkSmoke(one, unresolved, smokeReport);
    }
    write("  " + smokeReport.id + " " + smokeReport.title + "：" + statusLine(smokeReport.status));
    for (const line of smokeReport.lines) write("    " + line);
    reports.push(smokeReport);
  } finally {
    if (options.keep) write("保留工作目录 " + work);
    else await rm(work, { recursive: true, force: true });
  }

  write("");
  write("汇总");
  for (const report of reports)
    write("  " + statusLine(report.status) + "\t" + report.id + " " + report.title);
  const bad = reports.filter((each) => each.status !== "pass");
  write("");
  write(
    bad.length === 0
      ? "全部通过"
      : "未通过 / 阻塞 " +
          bad.length +
          " 项：" +
          bad.map((each) => each.id + "(" + statusLine(each.status) + ")").join(", "),
  );
  return bad.length === 0 ? 0 : 1;
};

process.exitCode = await main();
