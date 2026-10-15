import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveConfiguredHome } from "@morlay/dsh-desktop-shell/dshhome";
import { OFFICIAL_PROFILE_BUNDLES } from "@morlay/dsh-desktop-shell/official";

export const PROFILE_NAME = "desktop";

export interface DesktopConfig {
  readonly id: string;
  readonly version: string;
  readonly dataDir: string;
  readonly window: {
    readonly width: number;
    readonly height: number;
    readonly minWidth: number;
    readonly minHeight: number;
  };
  readonly displayName: string;
  readonly icon?: string;
}

export interface WorkspaceManifest {
  readonly name?: string;
  readonly version?: string;
  readonly files?: string[];
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly dsh?: {
    readonly version?: string;
    readonly profile?: { readonly bundles?: unknown };
    readonly desktop?: {
      readonly id?: string;
      readonly name?: string;
      /** 数据面根（`$DSH_HOME` 的三态：`xdg` / `env` / 绝对路径）。 */
      readonly dataDir?: string;
      /** 只有桌面形态要挂的装配行（web 形态读 `dsh.profile.bundles`）。 */
      readonly profile?: { readonly bundles?: unknown };
      readonly icon?: string;
      readonly window?: Record<string, number>;
    };
  };
}

export type ResolvedWorkspaceManifest = WorkspaceManifest & { readonly name: string };

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function resolveWorkspace(): string {
  return resolve(process.cwd());
}

export async function workspaceManifest(workspace: string): Promise<ResolvedWorkspaceManifest> {
  const value = JSON.parse(
    await readFile(join(workspace, "package.json"), "utf8"),
  ) as WorkspaceManifest;
  if (typeof value.name !== "string" || value.name === "") {
    throw new Error(`dshdev: workspace ${workspace} has no package name`);
  }
  return { ...value, name: value.name };
}

export function dshVersion(manifest: WorkspaceManifest): string | undefined {
  const version = manifest.dsh?.version;
  if (version === undefined) return undefined;
  if (typeof version !== "string" || version === "") {
    throw new Error(
      `dshdev: workspace ${String(manifest.name)} has an invalid dsh.version ` +
        `(expected a dependency spec such as "0.1.5-rc.1" or "workspace:*")`,
    );
  }
  return version;
}

// `displayName` 是桌面应用的对外名字（electron-builder 的 `productName`、安装后的启动器名）；壳的身份标识
// （自定义协议 scheme、`dataDir` 目录名）仍取包名 `name`——见 [设计 桌面标识取自 app 名](../.agents/designs/20260921-桌面标识取自app名.md)。
export function desktopConfig(manifest: ResolvedWorkspaceManifest): DesktopConfig {
  const desktop = manifest.dsh?.desktop ?? {};
  const window = desktop.window ?? {};
  return {
    id: desktop.id ?? "ai.deepseek.dsh.custom",
    version: manifest.version ?? "0.0.1",
    dataDir: desktop.dataDir ?? "xdg",
    displayName: desktop.name === undefined || desktop.name === "" ? manifest.name : desktop.name,
    window: {
      width: window.width ?? 1280,
      height: window.height ?? 800,
      minWidth: window.minWidth ?? 800,
      minHeight: window.minHeight ?? 600,
    },
    ...(desktop.icon === undefined ? {} : { icon: desktop.icon }),
  };
}

// 装配清单显式写在 app 的清单里，工具不替它合并：`dsh.profile.bundles` 是**两种形态共用**的那些，
// `dsh.desktop.profile.bundles` 是**只有桌面形态**才要挂的。清单写在哪一层，就是哪一层的语义。
export function appProfileBundles(manifest: WorkspaceManifest): string[] {
  const bundles = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(bundles) || !bundles.every((bundle) => typeof bundle === "string")) {
    throw new Error(`dshdev: workspace ${String(manifest.name)} has no dsh.profile.bundles`);
  }
  return bundles as string[];
}

// 桌面形态的装配清单：共用的那份 + 桌面独有的那段（顺序照写的顺序，重复的按包名去掉）。
export function desktopProfileBundles(manifest: WorkspaceManifest): string[] {
  const desktop = manifest.dsh?.desktop?.profile?.bundles;
  const extra =
    desktop === undefined
      ? []
      : Array.isArray(desktop) && desktop.every((bundle) => typeof bundle === "string")
        ? (desktop as string[])
        : (() => {
            throw new Error(
              `dshdev: workspace ${String(manifest.name)} has an invalid dsh.desktop.profile.bundles`,
            );
          })();
  const merged = [...appProfileBundles(manifest)];
  for (const name of extra) if (!merged.includes(name)) merged.push(name);
  return merged;
}

// 打包形态（桌面）那份清单按官方形态写：官方 bundles 在前，app 自己声明的在后（共用 + 桌面独有）。
// app 的清单里已经列过的官方 bundles 按包名去重，同一层不插两遍。
export function mergedProfileBundles(manifest: WorkspaceManifest): string[] {
  const official = new Set(OFFICIAL_PROFILE_BUNDLES);
  return [
    ...OFFICIAL_PROFILE_BUNDLES,
    ...desktopProfileBundles(manifest).filter((name) => !official.has(name)),
  ];
}

export async function findWorkspaceRoot(workspace: string): Promise<string> {
  let current = resolve(workspace);
  for (;;) {
    if (await pathExists(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current)
      throw new Error(`dshdev: no pnpm-workspace.yaml found above ${workspace}`);
    current = parent;
  }
}

export function buildCache(workspace: string): string {
  return join(workspace, "node_modules", ".dshdev");
}

// dev 形态的数据面：`dev`（Electron）与 `dev --web` 共用工作区的同一个 store（profile 名不同，互不冲突）。
export function devStoreHome(workspace: string): string {
  return join(workspace, ".dsh-store");
}

// dev 形态的**数据目录**（`$DSH_HOME`）：缺省是 profileDir 下的 `.dsh-store`（dev 的 profileDir 就是工作区）。
//
// **两种形态的缺省有意不同**：dev 落在工作区里，打包形态落在系统应用数据目录（`xdg` → macOS 的
// `~/Library/Application Support/<name>`）。开发不该污染稳定版本的数据（会话库、凭据）；要对齐两边就
// `--data-dir=xdg`（三态，与打包形态共用一份规则）。
export function resolveDataDir(workspace: string, name: string, spec?: string): string {
  if (spec === undefined) return devStoreHome(workspace);
  const configured = resolveConfiguredHome(name, spec);
  if (configured !== undefined) return configured;
  const ambient = process.env.DSH_HOME;
  if (ambient === undefined || ambient.trim() === "")
    throw new Error(
      "dshdev: --data-dir=env needs DSH_HOME in the environment " +
        "(pass xdg or an absolute path instead)",
    );
  return resolve(ambient);
}

export function cleanDeployedSpec(spec: string): string {
  const suffix = spec.indexOf("(");
  return suffix === -1 ? spec : spec.slice(0, suffix);
}

const DEPLOY_SETTINGS_KEYS = new Set([
  "minimumReleaseAge",
  "minimumReleaseAgeExclude",
  "minimumReleaseAgeIgnoreMissingTime",
  "minimumReleaseAgeStrict",
  "nodeLinker",
  "autoInstallPeers",
]);

const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]|$)/u;

function splitLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").split("\n");
}

function topLevelBlocks(lines: readonly string[]): { key: string; start: number; end: number }[] {
  const blocks: { key: string; start: number; end: number }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = TOP_LEVEL_KEY.exec(lines[index] ?? "");
    if (match === null) continue;
    let end = index;
    while (/^[ \t]/u.test(lines[end + 1] ?? "")) end += 1;
    blocks.push({ key: match[1] ?? "", start: index, end });
    index = end;
  }
  return blocks;
}

// One top-level YAML block by key, including its indented lines and a trailing newline;
// `undefined` when the key is absent.
export function topLevelYamlBlock(text: string, key: string): string | undefined {
  const lines = splitLines(text);
  const block = topLevelBlocks(lines).find((candidate) => candidate.key === key);
  return block === undefined
    ? undefined
    : `${lines.slice(block.start, block.end + 1).join("\n")}\n`;
}

export function mergedDeploySettings(source: string, destination: string): string {
  const sourceLines = splitLines(source);
  const inherited = new Map<string, string[]>();
  for (const block of topLevelBlocks(sourceLines)) {
    if (!DEPLOY_SETTINGS_KEYS.has(block.key)) continue;
    inherited.set(block.key, sourceLines.slice(block.start, block.end + 1));
  }

  const destinationLines = splitLines(destination);
  const starts = new Map(topLevelBlocks(destinationLines).map((block) => [block.start, block]));
  const merged: string[] = [];
  const replaced = new Set<string>();
  for (let index = 0; index < destinationLines.length; index += 1) {
    const block = starts.get(index);
    if (block === undefined) {
      merged.push(destinationLines[index] ?? "");
      continue;
    }
    const replacement = inherited.get(block.key);
    if (replacement === undefined) {
      merged.push(...destinationLines.slice(index, block.end + 1));
    } else if (!replaced.has(block.key)) {
      merged.push(...replacement);
      replaced.add(block.key);
    }

    index = block.end;
  }
  while (merged.length > 0 && (merged[merged.length - 1] ?? "").trim() === "") merged.pop();
  for (const [key, lines] of inherited) {
    if (!replaced.has(key)) merged.push(...lines);
  }
  return merged.length === 0 ? "" : `${merged.join("\n")}\n`;
}

export async function packageVersion(path: string, subject: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as { version?: string };
  if (typeof manifest.version !== "string")
    throw new Error(`dshdev: ${subject} has no version`);
  return manifest.version;
}

export function runPnpm(args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`desktop seed: pnpm ${args.join(" ")} exited with ${String(code ?? signal)}`),
        );
    });
  });
}
