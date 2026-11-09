import { logOf } from "@local/devkit/log";
// CI 的**发布步骤**（发布一律走 CI；本地别跑它）。
//
// 由 `pnpm -r --filter './packages/*/*' --workspace-concurrency=1 exec dshdev publish` 在每个包目录下唤起，
// 只处理**当前包**：只发布 `@morlay/*`（上游由 deepseek-harness 自己发）、已发布过的跳过（以 registry 的查询
// 为准：发布失败后复核，并发下另一个 job 先发完也算已发布）、按版本算 dist-tag。
import { execFile, spawn } from "node:child_process";
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

// 发布要占着当前终端跑：stdin 得是 TTY，pnpm 才能提示并读 OTP；进度与错误也直接进终端。
// 代价是没有捕获的 stderr 可分类——「版本已在」改问 registry（`pnpm view`），那本来就是唯一事实。
function inherit(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
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
  const status = await inherit("pnpm", [
    "publish",
    "--access=public",
    `--tag=${tag}`,
    `--publish-branch=${options.branch ?? process.env["GITHUB_REF_NAME"] ?? "main"}`,
    "--registry",
    registry,
  ]);
  if (status === 0) return 0;
  // 「版本已在」是成功（并发下另一个 job 先发完是常态）：以 registry 的查询为准，不看退出码与文案。
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
  return status ?? 1;
}
