// 发布入口（由 `just publish` / `just publish-npm` 调用）：按包清单筛选发布集合，算 dist-tag，
// 跳过 registry 上已有的版本，再逐包 `pnpm publish`。本地保护（GitHub Packages 只走 CI）在 justfile。
//
// 默认地址是**本地模拟 registry**（`tool/npr` 的 verdaccio），不带 `--registry` 时绝不会发到真 registry。
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 不带 `--registry` 时的默认地址：本地模拟 registry（`tool/npr` 的 verdaccio，宿主机 7677）。 */
export const DEFAULT_REGISTRY = "http://127.0.0.1:7677/";

/** 只认 loopback：覆盖发布（unpublish → publish）是本地演练用的，真 registry 上那是真删除。 */
export function isLocalRegistry(registry: string): boolean {
  try {
    const host = new URL(registry).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

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
    ...registryOverride(name, registry),
  ]);
  return result.code === 0;
}

/**
 * 撤掉 registry 上的同名同版本（`--force-republish` 的第一步）。
 * 版本本来就不在时它也回非零——调用方据此不看返回值。
 */
function unpublishOne(target: PublishTarget, registry: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      [
        "unpublish",
        "--force",
        `${target.name}@${target.version}`,
        "--registry",
        registry,
        ...registryOverride(target.name, registry),
      ],
      { cwd: target.dir, stdio: "inherit" },
    );
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * scoped 包的 registry 覆盖参数。
 * `--registry` 打不过 scope 级的 `@scope:registry`（`~/.npmrc` 与 `pnpm-workspace.yaml` 的 `registries`
 * 都算，实测 pnpm 12.21.0）；用 `--config.@scope:registry=<url>` 才能让调用方给的地址真的生效。
 */
export function registryOverride(name: string, registry: string): string[] {
  return name.startsWith("@")
    ? [`--config.${name.slice(0, name.indexOf("/"))}:registry=${registry}`]
    : [];
}

function publishOne(target: PublishTarget, tag: string, registry: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      [
        "publish",
        "--access=public",
        "--no-git-checks",
        `--tag=${tag}`,
        "--registry",
        registry,
        ...registryOverride(target.name, registry),
      ],
      { cwd: target.dir, stdio: "inherit" },
    );
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** `--registry` 的取值；不给就用本地模拟 registry。 */
export function registryOf(args: readonly string[]): string {
  const index = args.indexOf("--registry");
  return index >= 0 ? (args[index + 1] ?? DEFAULT_REGISTRY) : DEFAULT_REGISTRY;
}

/**
 * 跑发布：`--dry-run` 只打印；`--force-republish` 先 `unpublish --force` 再 `publish`（同名同版本覆盖）。
 * 覆盖只对 loopback registry 开放——真 registry 上 unpublish 是真删除。
 */
export async function run(root: string, args: readonly string[]): Promise<number> {
  const registry = registryOf(args);
  const dryRun = args.includes("--dry-run");
  const forceRepublish = args.includes("--force-republish");
  if (forceRepublish && !isLocalRegistry(registry)) {
    process.stderr.write(
      `publish: --force-republish 只对本地模拟 registry 开放（当前 ${registry}）；真 registry 上那是真删除\n`,
    );
    return 1;
  }
  const targets = await publishTargets(root);
  if (targets.length === 0) {
    process.stderr.write("publish: 没有可发布的包\n");
    return 1;
  }
  // 走 stderr：stdout 上的 `to publish` / `skip` 行是给脚本与票据解析的，别插别的行。
  process.stderr.write(`registry ${registry}\n`);
  for (const target of targets) {
    const tag = distTagOf(target.version);
    const covered =
      forceRepublish || !(await alreadyPublished(target.name, target.version, registry));
    if (!covered) {
      process.stdout.write(`skip ${target.name}@${target.version}（已发布）\n`);
      continue;
    }
    const verb = forceRepublish ? "republish" : "publish";
    if (dryRun) {
      process.stdout.write(`to ${verb} ${target.name}@${target.version} (tag: ${tag})\n`);
      continue;
    }
    if (forceRepublish) {
      await unpublishOne(target, registry);
      process.stdout.write(`${verb} ${target.name}@${target.version} (tag: ${tag})\n`);
    } else {
      process.stdout.write(`${verb} ${target.name}@${target.version} (tag: ${tag})\n`);
    }
    const code = await publishOne(target, tag, registry);
    if (code !== 0) return code;
  }
  return 0;
}

// 只在作为命令直接运行时执行；被测试 import 时不触发发布。
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) process.exitCode = await run(process.cwd(), process.argv.slice(2));
