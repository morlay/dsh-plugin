import { logOf } from "@local/devkit/log";
// CI 的**发布步骤**（发布一律走 CI；本地别跑它）。
//
// 由 `pnpm -r --filter './packages/*/*' --workspace-concurrency=1 exec dshdev publish` 在每个包目录下唤起，
// 只处理**当前包**：`private: true` 的跳过（本地专用 profile 不发）、只发布 `@morlay/*`（上游由
// deepseek-harness 自己发）、已发布过的跳过（以 registry 的查询为准：发布失败后复核，并发下另一个 job
// 先发完也算已发布）、按版本算 dist-tag。
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

/**
 * 发布结果的三态判定。
 *
 * `already-published` 是**成功**：版本已经在 registry 上，重发既不该失败也不该改任何东西——并发下
 * 另一个 job 先发完是常态。npm 系 registry 对「覆盖已发布版本」回 403 + "cannot publish over the
 * previously published versions"（pnpm 包一层 `ERR_PNPM_FAILED_TO_PUBLISH`），不是 409；两种都认。
 *
 * 这条判定必须看**发布当下**的输出：只靠事后问 registry 会踩 pnpm 的元数据缓存（刚发成功的版本仍报 404）。
 */
export function publishOutcome(result: {
  status: number | null;
  /** 本次发布的 stderr（pnpm 把 `PnpmError` 写在这一侧）。 */
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
 * 起子进程：**stdin 与 stdout 都交给当前终端**——pnpm 处理 OTP 时要求两者都是 TTY
 *（`resolveOtpChallenge`：`!stdin.isTTY || !stdout.isTTY` 就直接 `ERR_PNPM_OTP_NON_INTERACTIVE`），
 * 少继承一个就在 OTP 这一步失败。stderr 走管道：一边原样转发，一边留文本给 `publishOutcome`
 *（pnpm 的错误写在这一侧）。
 */
function inheritWithStderr(
  command: string,
  args: string[],
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["inherit", "inherit", "pipe"] });
    let stderr = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => resolve({ status: null, stderr: stderr + String(error) }));
    child.on("close", (code) => resolve({ status: code, stderr }));
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
  const { name, version, private: isPrivate } = JSON.parse(
    await readFile(join(cwd, "package.json"), "utf8"),
  ) as {
    name: string;
    version: string;
    private?: boolean;
  };

  if (isPrivate === true) {
    log.info(`skip ${name}: package.json is private`);
    return 0;
  }

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
  const published = await inheritWithStderr("pnpm", [
    "publish",
    "--access=public",
    `--tag=${tag}`,
    `--publish-branch=${options.branch ?? process.env["GITHUB_REF_NAME"] ?? "main"}`,
    "--registry",
    registry,
  ]);
  const outcome = publishOutcome(published);
  if (outcome === "published") return 0;
  if (outcome === "already-published") {
    log.info(`skip ${name}: ${version} already published（registry 拒绝重复发布）`);
    return 0;
  }
  // 文案变了也认「版本已在」这个事实：文案只是快路径，最终以 registry 的查询为准。
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
