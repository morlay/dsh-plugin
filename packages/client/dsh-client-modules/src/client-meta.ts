/**
 * 浏览器构建里烘焙的版本元数据。
 *
 * 上游的 client 构建（`scripts/client-build-environment.ts`）把一组 `DSH_CLIENT_*` 值当 `define` 注入产物：
 * - `DSH_CLIENT_VERSION`：设置页「当前版本」那一行；
 * - `DSH_CLIENT_COMMIT_HASH` + `DSH_CLIENT_GIT_DIRTY`：侧栏显示的 `<commit>` / `<commit>-dirty`；
 * - `DSH_CLIENT_BUILD_PROFILE`：`official` / `local`（官方品牌只在 official 下出现）。
 *
 * 这条链以前把 `process.env` 整个替换成 `{ env: {} }`，于是这些值全是 `undefined`：版本行不显示、
 * `ui-settings-account` 还会因为 `DSH_CLIENT_VERSION` 缺失直接抛错。取值顺序（越靠前越权威）：
 *
 * 1. 宿主进程的 `DSH_CLIENT_*`（`dshdev` 与桌面壳在起宿主时注入）；
 * 2. 仓库根的 `.dsh-build/client-build-environment.json`（`just prepare` 里的 `dshdev client-meta` 写）；
 * 3. 现算：仓库根的 `package.json` 版本 + `git rev-parse` / `git status`（dev 常见，代价是几次 git 调用）。
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/** 一份构建元数据；缺项表示该值不可得（前端自己会判 `undefined`）。 */
export interface ClientBuildMeta {
  readonly version?: string;
  readonly commit?: string;
  readonly dirty?: boolean;
}

/** `prepare` 写、构建读的那份记录（形状与上游 `client-build-environment.json` 一致）。 */
export const CLIENT_BUILD_RECORD = join(".dsh-build", "client-build-environment.json");

const VERSION = "DSH_CLIENT_VERSION";
const COMMIT = "DSH_CLIENT_COMMIT_HASH";
const DIRTY = "DSH_CLIENT_GIT_DIRTY";
const PROFILE = "DSH_CLIENT_BUILD_PROFILE";

/** 环境里那组 `DSH_CLIENT_*` → 元数据。 */
function metaOfEnvironment(environment: NodeJS.ProcessEnv): ClientBuildMeta {
  const version = environment[VERSION];
  const commit = environment[COMMIT];
  const dirty = environment[DIRTY];
  return {
    ...(version === undefined || version === "" ? {} : { version }),
    ...(commit === undefined || commit === "" ? {} : { commit }),
    ...(dirty === "true" ? { dirty: true } : {}),
  };
}

const runFile = promisify(execFile);

/** `git` 的输出；不在 git 工作树里、或 git 不可用时 undefined。 */
async function gitOutput(root: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await runFile("git", args, { cwd: root, encoding: "utf8" });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * 现算：**装的是哪一版 harness**（`DEEPSEEK_HARNESS_VERSION`，与同步链同一个真源）+ 本仓库的 git 元数据。
 *
 * 正常路径拿不到这里：`dshdev` 会注入环境、`prepare` 会写记录。只有"绕过 dshdev 直接构建 client 产物"
 * 时才走到，所以版本只能取环境或仓库根的 `package.json`（后者不是权威值，缺 env 时用它兜底）。
 */
async function computeMeta(repoRoot: string): Promise<ClientBuildMeta> {
  const explicit = process.env["DEEPSEEK_HARNESS_VERSION"];
  let version: string | undefined = explicit === undefined || explicit === "" ? undefined : explicit;
  if (version === undefined) {
    const manifest = await readFile(join(repoRoot, "package.json"), "utf8").catch(() => undefined);
    if (manifest !== undefined) {
      const parsed = JSON.parse(manifest) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version !== "") version = parsed.version;
    }
  }
  const commit = await gitOutput(repoRoot, ["rev-parse", "--short=7", "HEAD"]);
  const status = await gitOutput(repoRoot, ["status", "--porcelain", "--untracked-files=normal"]);
  return {
    ...(version === undefined ? {} : { version }),
    ...(commit === undefined ? {} : { commit }),
    ...(status === undefined || status === "" ? {} : { dirty: true }),
  };
}

/** 读 `prepare` 写下的那份记录（缺失 / 坏掉都给 undefined，不挡构建）。 */
async function recordedMeta(repoRoot: string): Promise<ClientBuildMeta | undefined> {
  const raw = await readFile(join(repoRoot, CLIENT_BUILD_RECORD), "utf8").catch(() => undefined);
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as { environment?: Record<string, string> };
    const environment = parsed.environment ?? {};
    return metaOfEnvironment(environment as NodeJS.ProcessEnv);
  } catch {
    return undefined;
  }
}

/**
 * 这个仓库在浏览器产物里该带的版本元数据。
 * @param repoRoot - 仓库根（dev 是工作区，打包形态是 profile：那里通常读不到记录，靠宿主注入的环境）。
 */
export async function clientBuildMeta(repoRoot: string): Promise<ClientBuildMeta> {
  const inherited = metaOfEnvironment(process.env);
  if (inherited.version !== undefined && inherited.commit !== undefined) return inherited;
  const recorded = await recordedMeta(repoRoot);
  const computed = recorded ?? (await computeMeta(repoRoot));
  return { ...computed, ...inherited };
}

/**
 * `define` 用的一组键：`process.env.DSH_CLIENT_*` → 字面量。
 *
 * `browserProcessPlugin` 会跳过这些键（见那里的负向前瞻），所以 define 这一层能把它们换成真实值；
 * 其余 `process.env` 仍是空壳对象。
 */
export function clientMetaDefines(meta: ClientBuildMeta): Record<string, string> {
  return {
    [`process.env.${VERSION}`]: meta.version === undefined ? "undefined" : JSON.stringify(meta.version),
    [`process.env.${COMMIT}`]: meta.commit === undefined ? "undefined" : JSON.stringify(meta.commit),
    [`process.env.${DIRTY}`]: meta.dirty === true ? JSON.stringify("true") : "undefined",
    // 我们不是官方构建：官方品牌（`ui-brand-official`）按这个值判断，不该冒用。
    [`process.env.${PROFILE}`]: JSON.stringify("local"),
  };
}
