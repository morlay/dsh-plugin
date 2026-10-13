import { spawn } from "node:child_process";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { rolldown } from "rolldown";
import { dts } from "rolldown-plugin-dts";

// 声明产物分两步拼出来：一步是**全仓一次**的类型图——`dts-project.ts` 让 tsgo 扫宿主 / client 两叶，
// 声明树落在 `<root>/target/dts/`；另一步就是这里——按路径取某个包那份声明、合并成单文件。
//
// 为什么拆开：`rolldown-plugin-dts` 默认给**每个包各建一次类型图**（实测单包 dts 4.8s，占该包构建 82%），
// 一个仓库 27 个包就是重复 27 次。共享一份全仓类型图后，每包只剩合并（几十毫秒）。这里用的是它的
// `dtsInput` 模式：入口本身就是已有声明，它不建 program。
//
// 相对路径的基准取**声明树里的包目录**（不是仓库根），这样产物里的 `//#region` 注释与按源码生成时一致
// （`src/types.d.ts` 而不是 `target/dts/packages/.../src/types.d.ts`）。

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export type EmitDtsOptions = {
  /** 包目录（绝对路径）。 */
  cwd: string;
  /** 仓库根（把包目录换算成声明树里的相对路径）。 */
  root: string;
  /** 声明树根：`<root>/target/dts/`。 */
  dtsRoot: string;
  /** 入口名 → 源码路径（相对包目录），如 `{ index: "./src/index.ts" }`。 */
  entries: Record<string, string>;
  /** 产物目录（相对包目录或绝对），默认 `dist`。 */
  outDir?: string;
  /** 留在产物外的包，默认所有 bare specifier——声明里的上游 / 第三方类型靠 import 引用，不展开。 */
  external?: (id: string) => boolean;
};

export async function emitDts(options: EmitDtsOptions): Promise<void> {
  const { cwd, root, dtsRoot, entries } = options;
  const dtsCwd = join(dtsRoot, relative(root, cwd));
  const input: Record<string, string> = {};
  for (const [name, entry] of Object.entries(entries)) {
    const relativeEntry = entry.replace(/^\.\//u, "").replace(/\.(?:tsx?|mts|cts)$/u, ".d.ts");
    const file = join(dtsCwd, relativeEntry);
    if (!(await pathExists(file))) {
      throw new Error(`声明缺失: ${file}（先跑 target/dts 的全仓声明生成）`);
    }
    input[name] = file;
  }
  const bundle = await rolldown({
    input,
    cwd: dtsCwd,
    external: options.external ?? ((id: string) => !id.startsWith(".") && !isAbsolute(id)),
    // `sideEffects: true`：声明里的裸 import（`import "@deepseek-ai/dsh-session"`）是**类型增强的副作用**，
    // 默认的 tree-shaking 会把它删掉，消费方的 `declare module` 合并就落空了。
    plugins: [dts({ dtsInput: true, cwd: dtsCwd, sideEffects: true })],
  });
  const outDir = isAbsolute(options.outDir ?? "dist")
    ? (options.outDir as string)
    : join(cwd, options.outDir ?? "dist");
  try {
    await bundle.write({
      dir: outDir,
      format: "es",
      entryFileNames: "[name].d.mts",
      chunkFileNames: "[name]-[hash].d.mts",
      sourcemap: false,
    });
    // 双格式包的 client 半在构建里是 CJS，出口清单的 `types` 指 `.d.cts`（tsdown 的双格式各产一份声明）；
    // 声明内容两者一致，所以这里把 ESM 那份复制成 CJS 那份，清单不必改口径。
    if (Object.hasOwn(entries, "client")) {
      const esm = join(outDir, "client.d.mts");
      if (await pathExists(esm)) await copyFile(esm, join(outDir, "client.d.cts"));
    }
  } finally {
    await bundle.close();
  }
}

const UPSTREAM_SRC = [
  "vendor/deepseek-harness/packages/*/*/src/**/*",
  "vendor/deepseek-harness/vendor/*/src/**/*",
  "vendor/deepseek-harness/native/*/packages/*/src/**/*",
] as const;

// 两个 face 的扫描范围：宿主含全部产品源码（排除 client 半），client 只含 client 半——两半的 cordis Context
// 会在同一个 program 里合并同一批键，一个 program 看不了两边。
const FACES = {
  host: {
    include: ["packages/*/*/src/**/*", "devpackages/*/src/**/*", ...UPSTREAM_SRC],
    exclude: ["**/src/client/**", "**/__tests__/**"],
  },
  client: {
    include: [
      "packages/*/*/src/client/**/*",
      "vendor/deepseek-harness/packages/*/*/src/client/**/*",
      "vendor/deepseek-harness/vendor/*/src/client/**/*",
    ],
    exclude: ["**/__tests__/**"],
  },
} as const;

/** 全仓声明生成（一步）：tsgo 按两个 face 各扫一次，声明树落 `target/dts`，供 `emitDts` 与 typert 生成取用。 */
export async function generateWorkspaceDts(root: string): Promise<void> {
  const outDir = dtsRootOf(root);
  await rm(outDir, { recursive: true, force: true });
  for (const face of Object.keys(FACES) as (keyof typeof FACES)[]) {
    const config = join(root, ".tmp", `dts-${face}.json`);
    const base = relative(dirname(config), root).split(sep).join("/");
    const under = (pattern: string): string => (base === "" ? pattern : `${base}/${pattern}`);
    await mkdir(dirname(config), { recursive: true });
    await writeFile(
      config,
      `${JSON.stringify(
        {
          extends: join(root, "devpackages", "devkit", "tsconfig.json"),
          compilerOptions: {
            composite: false,
            incremental: false,
            declaration: true,
            emitDeclarationOnly: true,
            // 只要声明、不要诊断：这一步是产物生成，不是类型门禁（门禁是两叶 + oxlint）。
            noCheck: true,
            noEmit: false,
            outDir,
            rootDir: under("."),
          },
          include: FACES[face].include.map(under),
          exclude: FACES[face].exclude.map(under),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`[dts] ${face} face -> ${outDir}`);
    await run("pnpm", ["exec", "tsc", "-p", config], root);
  }
}

async function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`命令失败: ${command} ${args.join(" ")}（exit ${String(code)}）`));
    });
  });
}

/** 声明树根：仓库根的 `target/dts/`（`generateWorkspaceDts` 的产物，`emitDts` 的来源）。 */
export function dtsRootOf(root: string): string {
  return join(root, "target", "dts");
}

/** 从某个目录向上找仓库根（`pnpm-workspace.yaml` 所在处）。 */
export async function repoRootOf(from: string): Promise<string> {
  for (let current = resolve(from); ;) {
    if (await pathExists(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) throw new Error(`找不到 pnpm-workspace.yaml（从 ${from} 向上）`);
    current = parent;
  }
}
