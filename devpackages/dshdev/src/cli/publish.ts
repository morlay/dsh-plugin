import { logOf } from "@local/devkit/log";
// CI 的**发布步骤**（发布一律走 CI；本地别跑它）。
//
// 由 `pnpm -r --filter './packages/*/*' --workspace-concurrency=1 exec dshdev publish` 在每个包目录下唤起，
// 只处理**当前包**：只发布 `@morlay/*`（上游由 deepseek-harness 自己发）、已发布过的跳过（发布那一刻被
// registry 以「不能覆盖已发布版本」拒绝也算已发布）、按版本算 dist-tag。
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_REGISTRY = "https://npm.pkg.github.com/";

/** 稳定版 → latest；`-alpha.*` → alpha；其余预发布（rc / beta / …）→ next。 */
const log = logOf("dshdev");

export function distTagOf(version: string): string {
  const dash = version.indexOf("-");
  if (dash < 0) return "latest";
  const prerelease = version.slice(dash + 1).split("+")[0] ?? "";
  return prerelease.split(".")[0] === "alpha" ? "alpha" : "next";
}

// 捕获 stdout/stderr 地跑子进程：非零退出不抛，交给调用方按退出码与输出判断。
async function capture(
  command: string,
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { encoding: "utf8" });
    return { status: 0, stdout, stderr };
  } catch (error: unknown) {
    const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      status: typeof failure.code === "number" ? failure.code : null,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
    };
  }
}

/**
 * 发布结果的三态判定。
 *
 * `already-published` 是**成功**：版本已经在 registry 上，重发既不该失败也不该改任何东西——并发下
 * 另一个 job 先发完是常态。npm 系 registry 对「覆盖已发布版本」回 403 + "cannot publish over the
 * previously published versions"（pnpm 包一层 `ERR_PNPM_FAILED_TO_PUBLISH`），不是 409；两种都认。
 */
export function publishOutcome(result: {
  status: number | null;
  stderr: string;
}): "published" | "already-published" | "failed" {
  if (result.status === 0) return "published";
  if (result.status === 409) return "already-published";
  if (
    /cannot publish over the previously published versions|EPUBLISHCONFLICT|previously published/iu.test(
      result.stderr,
    )
  ) {
    return "already-published";
  }
  return "failed";
}

/**
 * 发布当前目录这个包（若还没发过）。
 *
 * @param options - `cwd`（缺省当前目录）、`registry`（缺省 GitHub Packages）。
 */
export async function runPublish(options: {
  readonly cwd?: string;
  readonly registry?: string;
  readonly branch?: string;
}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const { name, version } = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };

  if (!name.startsWith("@morlay/")) {
    log.info(`skip ${name}: only @morlay/* packages are published from this repo`);
    return 0;
  }

  const view = await capture("pnpm", [
    "view",
    `${name}@${version}`,
    "version",
    "--registry",
    registry,
  ]);
  if (view.status === 0) {
    log.info(`skip ${name}: ${version} already published`);
    return 0;
  }
  if (
    !(
      view.stderr.includes("ERR_PNPM_PACKAGE_NOT_FOUND") ||
      view.stderr.includes("ERR_PNPM_FETCH_404")
    )
  ) {
    process.stderr.write(view.stderr);
    return 1;
  }

  const tag = distTagOf(version);
  log.info(`to publish: ${name}@${version} (tag: ${tag})`);
  const published = await capture("pnpm", [
    "publish",
    "--access=public",
    `--tag=${tag}`,
    `--publish-branch=${options.branch ?? process.env["GITHUB_REF_NAME"] ?? "main"}`,
    "--registry",
    registry,
  ]);
  if (published.stdout.length > 0) process.stdout.write(published.stdout);
  if (published.stderr.length > 0) process.stderr.write(published.stderr);
  const outcome = publishOutcome(published);
  if (outcome === "published") return 0;
  if (outcome === "already-published") {
    log.info(`skip ${name}: ${version} already published（registry 拒绝重复发布）`);
    return 0;
  }
  // 文案变了也认「版本已在」这个事实：分类只是快路径，最终以 registry 的查询为准。
  const recheck = await capture("pnpm", [
    "view",
    `${name}@${version}`,
    "version",
    "--registry",
    registry,
  ]);
  if (recheck.status === 0) {
    log.info(`skip ${name}: ${version} already published`);
    return 0;
  }
  return published.status ?? 1;
}
