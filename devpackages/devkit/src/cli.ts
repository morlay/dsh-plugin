#!/usr/bin/env node
// devkit 的命令面：`build` 用 rolldown 打 host 面并写回清单，`audit` 跑结构性判据。
// 两条命令都从仓库根跑；build 的入口从各包 `exports` 推导，不依赖 tsdown。
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackage, planOf } from "./build/compile.ts";
import { writeBuildManifest } from "./build/package-exports.ts";

const here = dirname(fileURLToPath(import.meta.url));

const USAGE = `devkit <build|audit> [选项]

  devkit build [--filter <包>]   用 rolldown 打各包的 host 面并写回清单
  devkit audit [--write]         逐包判据 + 根上汇总；--write 删未用依赖
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

/** 遍历 `packages/<family>/<pkg>`；给了 filter 时只留包名匹配的那个。 */
async function findPackages(root: string, filter: string | undefined): Promise<string[]> {
  const found: string[] = [];
  for (const family of await readdir(join(root, "packages"), { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    for (const entry of await readdir(join(root, "packages", family.name), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, "packages", family.name, entry.name);
      const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => undefined);
      if (raw === undefined) continue;
      const manifest = JSON.parse(raw) as { name?: string };
      if (filter !== undefined && manifest.name !== filter) continue;
      found.push(dir);
    }
  }
  return found;
}

async function build(args: readonly string[]): Promise<number> {
  const { filter } = takeFilter(args);
  const root = process.cwd();
  const targets = await findPackages(root, filter);
  if (targets.length === 0) {
    process.stderr.write(`devkit build: 没有匹配的包（filter: ${filter ?? "全部"}）\n`);
    return 1;
  }
  for (const dir of targets) {
    const plan = await planOf(dir);
    if (Object.keys(plan.entries).length === 0) continue;
    const artifacts = await buildPackage(dir, plan);
    const entries =
      plan.client === undefined ? plan.entries : { ...plan.entries, client: plan.client.source };
    await writeBuildManifest(dir, {
      entries,
      artifacts,
      ...(plan.client === undefined ? {} : { clientEntry: "client" }),
      declarationFiles: (entry) => (entry === "client" ? [] : [entry + ".d.mts"]),
      ...(plan.bundle === true ? { bundle: { rows: [] } } : {}),
      publishOnly: plan.publishOnly,
    });
    process.stdout.write(`built ${relative(root, dir)}\n`);
  }
  return 0;
}

async function audit(args: readonly string[]): Promise<number> {
  // 逐包扫描的输出经管道交给汇总器；两个进程的 stderr 都直接给终端。
  const scan = spawn(
    "pnpm",
    ["-r", "--filter", "./packages/*/*", "exec", "node", join(here, "audit/package-audit.ts")],
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

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === "build") return await build(rest);
  if (command === "audit") return await audit(rest);
  process.stderr.write(`devkit: 未知子命令 ${command}\n\n${USAGE}`);
  return 1;
}

process.exitCode = await main();
