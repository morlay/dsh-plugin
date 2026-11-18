// 发布入口（由 `just publish` / `just publish-npm` 调用）：按包清单筛选发布集合，算 dist-tag，
// 跳过 registry 上已有的版本，再逐包 `pnpm publish`。本地保护（GitHub Packages 只走 CI）在 justfile。
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 稳定版 → latest；`-alpha.*` → alpha；其余预发布 → next。 */
export function distTagOf(version: string): "latest" | "alpha" | "next" {
  const dash = version.indexOf("-");
  if (dash < 0) return "latest";
  const prerelease = version.slice(dash + 1).split("+")[0] ?? "";
  return prerelease.split(".")[0] === "alpha" ? "alpha" : "next";
}

/** 一个待发包：目录、包名、版本。 */
export interface PublishTarget {
  readonly dir: string;
  readonly name: string;
  readonly version: string;
}

/** 发布集合：`packages/<family>/<pkg>` 里 `private` 不是 true 的包，按目录名排序。 */
export async function publishTargets(root: string): Promise<PublishTarget[]> {
  const targets: PublishTarget[] = [];
  for (const family of await readdir(join(root, "packages"), { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    for (const entry of await readdir(join(root, "packages", family.name), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, "packages", family.name, entry.name);
      const raw = await readFile(join(dir, "package.json"), "utf8").catch(() => undefined);
      if (raw === undefined) continue;
      const manifest = JSON.parse(raw) as {
        name: string;
        version: string;
        private?: boolean;
      };
      if (manifest.private === true) continue;
      targets.push({ dir, name: manifest.name, version: manifest.version });
    }
  }
  return targets.sort((left, right) => left.name.localeCompare(right.name));
}

function capture(
  command: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => resolve({ code: 1, stdout }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function alreadyPublished(name: string, version: string, registry: string): Promise<boolean> {
  const result = await capture("pnpm", [
    "view",
    `${name}@${version}`,
    "version",
    "--registry",
    registry,
  ]);
  return result.code === 0;
}

function publishOne(target: PublishTarget, tag: string, registry: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["publish", "--access=public", "--no-git-checks", `--tag=${tag}`, "--registry", registry],
      { cwd: target.dir, stdio: "inherit" },
    );
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** 跑发布：`--registry <url>` 必给；`--dry-run` 只打印。 */
export async function run(root: string, args: readonly string[]): Promise<number> {
  const registryIndex = args.indexOf("--registry");
  const registry = registryIndex >= 0 ? args[registryIndex + 1] : undefined;
  if (registry === undefined) {
    process.stderr.write("publish: --registry <url> 必给\n");
    return 1;
  }
  const dryRun = args.includes("--dry-run");
  const targets = await publishTargets(root);
  if (targets.length === 0) {
    process.stderr.write("publish: 没有可发布的包\n");
    return 1;
  }
  for (const target of targets) {
    const tag = distTagOf(target.version);
    if (await alreadyPublished(target.name, target.version, registry)) {
      process.stdout.write(`skip ${target.name}@${target.version}（已发布）\n`);
      continue;
    }
    if (dryRun) {
      process.stdout.write(`to publish ${target.name}@${target.version} (tag: ${tag})\n`);
      continue;
    }
    process.stdout.write(`publish ${target.name}@${target.version} (tag: ${tag})\n`);
    const code = await publishOne(target, tag, registry);
    if (code !== 0) return code;
  }
  return 0;
}

// 只在作为命令直接运行时执行；被测试 import 时不触发发布。
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) process.exitCode = await run(process.cwd(), process.argv.slice(2));
