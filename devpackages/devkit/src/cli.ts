#!/usr/bin/env node
// devkit 的命令面：构建、审计，以及 npm 发布线（发布 / 验收 / 版本 / 清理）。
// 这里只做参数翻译与转发；判据、包发现、子进程编排都在对应模块里，justfile 只是 trigger。
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run as cleanRun } from "./build/clean.ts";
import { run as acceptanceRun } from "./release/acceptance.ts";
import { GITHUB_PACKAGES_REGISTRY, run as publishRun } from "./release/publish.ts";
import { run as versionRun } from "./release/version.ts";
import { PACKAGES_FILTER } from "./workspace/packages.ts";

const here = dirname(fileURLToPath(import.meta.url));

const USAGE = `devkit <build|audit|publish|verify-release|version|clean> [选项]

  devkit build [--filter <包>]        逐包构建并写回清单（包列表由 pnpm 的递归给出）
  devkit audit [--write]              逐包判据 + 根上汇总；--write 删未用依赖
  devkit publish [--github] [--dry-run] [--force-republish] [--registry <url>]
                                      发布；--github 走 GitHub Packages（只许在 CI 里跑）
  devkit verify-release [--filter <包>] [--keep]
                                      发布前验收（判据 2 / 7 / 8 / 9 / 10）
  devkit version <版本> [--dry-run]   只 bump 发布集合（dsh-oxc-node 走独立版本线）
  devkit clean                        删 target/dts 与各包 dist
`;

/** 等一个子进程结束，返回退出码（信号中断按 1）。 */
function wait(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** `--filter <包>` 从参数里摘出来，其余原样透传。 */
function takeFilter(args: readonly string[]): { filter?: string; rest: string[] } {
  const index = args.indexOf("--filter");
  if (index < 0) return { rest: [...args] };
  const filter = args[index + 1];
  const rest = args.filter((_, position) => position !== index && position !== index + 1);
  return filter === undefined ? { rest } : { filter, rest };
}

/** 逐包构建：每个包在自己的目录里跑一次 `build/one.ts`（包列表由 pnpm 的递归给出）。 */
async function build(args: readonly string[]): Promise<number> {
  const { filter } = takeFilter(args);
  const child = spawn(
    "pnpm",
    ["-r", "--filter", filter ?? PACKAGES_FILTER, "exec", "node", join(here, "build/one.ts")],
    { stdio: "inherit" },
  );
  return await wait(child);
}

async function audit(args: readonly string[]): Promise<number> {
  // 逐包扫描的输出经管道交给汇总器；两个进程的 stderr 都直接给终端。
  const scan = spawn(
    "pnpm",
    ["-r", "--filter", PACKAGES_FILTER, "exec", "node", join(here, "audit/package-audit.ts")],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const report = spawn("node", [join(here, "audit/summarize.ts"), ...args], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  scan.stdout?.pipe(report.stdin as NodeJS.WritableStream);
  const [scanCode, reportCode] = await Promise.all([wait(scan), wait(report)]);
  return reportCode === 0 ? scanCode : reportCode;
}

/** `--github` 翻译成 GitHub Packages 的地址；其余参数原样交给发布器。 */
async function publish(args: readonly string[]): Promise<number> {
  const github = args.includes("--github");
  const rest = args.filter((arg) => arg !== "--github");
  return await publishRun(
    process.cwd(),
    github ? [...rest, "--registry", GITHUB_PACKAGES_REGISTRY] : rest,
  );
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "build") return await build(rest);
  if (command === "audit") return await audit(rest);
  if (command === "publish") return await publish(rest);
  if (command === "verify-release") return await acceptanceRun(rest);
  if (command === "version") return await versionRun(process.cwd(), rest);
  if (command === "clean") return await cleanRun(process.cwd());
  process.stderr.write(`devkit: 未知子命令 ${command}\n\n${USAGE}`);
  return 1;
}

process.exitCode = await main();
