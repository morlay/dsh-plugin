import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveConfiguredHome } from "@morlay/dsh-desktop-shell/dshhome";
import { OFFICIAL_PROFILE_BUNDLES } from "@morlay/dsh-desktop-shell/official";

export const PROFILE_NAME = "desktop";

export interface DesktopConfig {
  readonly id: string;
  readonly version: string;
  readonly dshHome: string;
  readonly window: {
    readonly width: number;
    readonly height: number;
    readonly minWidth: number;
    readonly minHeight: number;
  };
  readonly icon?: string;
}

export interface WorkspaceManifest {
  readonly name?: string;
  readonly version?: string;
  readonly files?: string[];
  readonly dependencies?: Record<string, string>;
  readonly dsh?: {
    readonly version?: string;
    readonly profile?: { readonly bundles?: unknown };
    readonly desktop?: {
      readonly id?: string;
      readonly dshHome?: string;
      readonly icon?: string;
      readonly window?: Record<string, number>;
    };

    readonly dev?: {
      readonly web?: {
        readonly clientBundles?: {
          readonly prefixes?: unknown;
          readonly packages?: unknown;
        };
      };
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
    throw new Error(`dsh-desktopify: workspace ${workspace} has no package name`);
  }
  return { ...value, name: value.name };
}

export function dshVersion(manifest: WorkspaceManifest): string | undefined {
  const version = manifest.dsh?.version;
  if (version === undefined) return undefined;
  if (typeof version !== "string" || version === "") {
    throw new Error(
      `dsh-desktopify: workspace ${String(manifest.name)} has an invalid dsh.version ` +
        `(expected a dependency spec such as "0.1.5-rc.1" or "workspace:*")`,
    );
  }
  return version;
}

export function desktopConfig(manifest: WorkspaceManifest): DesktopConfig {
  const desktop = manifest.dsh?.desktop ?? {};
  const window = desktop.window ?? {};
  return {
    id: desktop.id ?? "ai.deepseek.dsh.custom",
    version: manifest.version ?? "0.0.1",
    dshHome: desktop.dshHome ?? "xdg",
    window: {
      width: window.width ?? 1280,
      height: window.height ?? 800,
      minWidth: window.minWidth ?? 800,
      minHeight: window.minHeight ?? 600,
    },
    ...(desktop.icon === undefined ? {} : { icon: desktop.icon }),
  };
}

export function appProfileBundles(manifest: WorkspaceManifest): string[] {
  const bundles = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(bundles) || !bundles.every((bundle) => typeof bundle === "string")) {
    throw new Error(
      `dsh-desktopify: workspace ${String(manifest.name)} has no dsh.profile.bundles`,
    );
  }
  return bundles as string[];
}

export function mergedProfileBundles(manifest: WorkspaceManifest): string[] {
  return [...OFFICIAL_PROFILE_BUNDLES, ...appProfileBundles(manifest)];
}

export interface DevWebConfig {
  readonly prefixes: string[];

  readonly packages: string[];
}

const DEFAULT_DEV_CLIENT_PREFIXES = ["@morlay/"];

function devStringList(subject: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item !== "")) {
    throw new Error(`dsh-desktopify: ${subject} must be a non-empty string list`);
  }
  return value as string[];
}

export function devWebConfig(manifest: WorkspaceManifest): DevWebConfig | undefined {
  const value = manifest.dsh?.dev?.web?.clientBundles;
  if (value === undefined) return undefined;
  const subject = `workspace ${String(manifest.name)} dsh.dev.web.clientBundles`;
  return {
    prefixes:
      value.prefixes === undefined
        ? [...DEFAULT_DEV_CLIENT_PREFIXES]
        : devStringList(`${subject}.prefixes`, value.prefixes),
    packages:
      value.packages === undefined ? [] : devStringList(`${subject}.packages`, value.packages),
  };
}

export async function findWorkspaceRoot(workspace: string): Promise<string> {
  let current = resolve(workspace);
  for (;;) {
    if (await pathExists(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current)
      throw new Error(`dsh-desktopify: no pnpm-workspace.yaml found above ${workspace}`);
    current = parent;
  }
}

export function buildRoot(workspace: string): string {
  return join(workspace, "node_modules", ".dsh-desktopify");
}

/** dev 形态的数据面：`dev`（Electron）与 `dev --web` 共用工作区的同一个 store（profile 名不同，互不冲突）。 */
export function devStoreHome(workspace: string): string {
  return join(workspace, ".dsh-store");
}

/**
 * dev 形态的数据面根：缺省是工作区内的 `.dsh-store`，`--home` 给出时按 `dshHome` 的三态解析
 * （`xdg` / `env` / 绝对路径，规则与打包形态共用一份，见 `dshhome.ts`）——`--home=xdg` 因此与
 * 打包形态落到同一个目录，排查时可以拿真实数据跑 dev 形态。
 */
export function resolveDevHome(workspace: string, name: string, spec?: string): string {
  if (spec === undefined) return devStoreHome(workspace);
  const configured = resolveConfiguredHome(name, spec);
  if (configured !== undefined) return configured;
  const ambient = process.env.DSH_HOME;
  if (ambient === undefined || ambient.trim() === "")
    throw new Error(
      "dsh-desktopify: --home=env needs DSH_HOME in the environment " +
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

/** One top-level YAML block by key, including its indented lines and a trailing newline.
 * @param text - YAML document text.
 * @param key - top-level key to extract.
 * @returns the block text, or undefined when the key is absent.
 */
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
    throw new Error(`dsh-desktopify: ${subject} has no version`);
  return manifest.version;
}
