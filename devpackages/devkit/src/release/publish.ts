// 发布入口（由 `just publish` / `just publish-npm` 调用）：按包清单筛选发布集合，算 dist-tag，
// 跳过 registry 上已有的版本，再逐包 `pnpm publish`。本地保护（GitHub Packages 只走 CI）在 justfile。
//
// 默认地址是**本地模拟 registry**（`tool/npr` 的 verdaccio），不带 `--registry` 时绝不会发到真 registry。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { workspacePackages } from "../workspace/packages.ts";
import { coverageProblems, type CoverageManifest } from "./manifest-coverage.ts";

/** 不带 `--registry` 时的默认地址：本地模拟 registry（`tool/npr` 的 verdaccio，宿主机 7677）。 */
export const DEFAULT_REGISTRY = "http://127.0.0.1:7677/";

/** GitHub Packages 的地址：这条通道只走 CI（本地没有发布者凭据，也没有人工卡点）。 */
export const GITHUB_PACKAGES_REGISTRY = "https://npm.pkg.github.com/";

/** 是不是 GitHub Packages 通道。 */
export function requiresCi(registry: string): boolean {
  return registry.startsWith(GITHUB_PACKAGES_REGISTRY);
}

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

/** 一个待发包：目录、包名、版本，以及清单（发布前校验读它）。 */
export interface PublishTarget {
  readonly dir: string;
  readonly name: string;
  readonly version: string;
  readonly manifest: CoverageManifest;
}

/** 发布集合：pnpm 递归给出的包里 `private` 不是 true 的那些（包列表不在这里自己找）。 */
export async function publishTargets(root: string): Promise<PublishTarget[]> {
  const targets: PublishTarget[] = [];
  for (const pkg of await workspacePackages(root)) {
    const manifest = pkg.manifest as unknown as CoverageManifest & {
      version: string;
      private?: boolean;
    };
    if (manifest.private === true) continue;
    targets.push({ dir: pkg.dir, name: manifest.name, version: manifest.version, manifest });
  }
  return targets;
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

/**
 * 发布同一 dist-tag 的一组包：一条 `pnpm -r publish`。
 *
 * **顺序交给 pnpm**：递归发布按 workspace 的依赖图拓扑排序（被依赖的先发），`--workspace-concurrency=1`
 * 保证串行。这里只按 tag 分组，不自己排包序。
 */
function publishGroup(
  root: string,
  targets: readonly PublishTarget[],
  tag: string,
  registry: string,
): Promise<number> {
  const filters = targets.flatMap((target) => ["--filter", target.name]);
  // scoped 包的 registry 覆盖：`--registry` 打不过 scope 映射，逐 scope 一条 `--config.<scope>:registry`。
  const overrides = [
    ...new Set(targets.flatMap((target) => registryOverride(target.name, registry))),
  ];
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      [
        "-r",
        ...filters,
        "publish",
        `--tag=${tag}`,
        "--access",
        "public",
        "--no-git-checks",
        "--workspace-concurrency=1",
        "--registry",
        registry,
        ...overrides,
      ],
      { cwd: root, stdio: "inherit" },
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
  if (requiresCi(registry) && process.env["GITHUB_ACTIONS"] === undefined) {
    process.stderr.write(
      "publish: GitHub Packages 只走 CI（本机没有发布者凭据）；本地发布用 `just publish-npm`\n",
    );
    return 1;
  }
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
  // 清单覆盖判据（与 `just verify-release` 的判据 2 同一份实现）：缺键或目标文件不在就不进发布子进程——
  // 发出去再发现少面只能靠升版本补救。纯读，不碰 registry。
  const problems: string[] = [];
  for (const target of targets) problems.push(...(await coverageProblems(target)));
  if (problems.length > 0) {
    process.stderr.write(
      "publish: 清单覆盖判据不通过（先修清单，或跑 `just build` 重写回）——" +
        problems.length +
        " 条\n",
    );
    for (const problem of problems) process.stderr.write("  " + problem + "\n");
    return 1;
  }
  // 走 stderr：stdout 上的 `to publish` / `skip` 行是给脚本与票据解析的，别插别的行。
  process.stderr.write(`registry ${registry}\n`);
  const pending: PublishTarget[] = [];
  for (const target of targets) {
    const covered =
      forceRepublish || !(await alreadyPublished(target.name, target.version, registry));
    if (!covered) {
      process.stdout.write(`skip ${target.name}@${target.version}（已发布）\n`);
      continue;
    }
    pending.push(target);
  }
  const verb = forceRepublish ? "republish" : "publish";
  if (dryRun) {
    for (const target of pending) {
      process.stdout.write(
        `to ${verb} ${target.name}@${target.version} (tag: ${distTagOf(target.version)})\n`,
      );
    }
    return 0;
  }
  if (forceRepublish) {
    // 覆盖式重发：先把同名同版本撤掉（顺序无关），再按依赖图发。
    for (const target of pending) {
      await unpublishOne(target, registry);
      process.stdout.write(`unpublished ${target.name}@${target.version}\n`);
    }
  }
  // 同一 dist-tag 一条 `pnpm -r publish`：组内按依赖图拓扑、串行；组间按 tag 依次。
  const groups = new Map<string, PublishTarget[]>();
  for (const target of pending) {
    const tag = distTagOf(target.version);
    groups.set(tag, [...(groups.get(tag) ?? []), target]);
  }
  for (const [tag, group] of groups) {
    const code = await publishGroup(root, group, tag, registry);
    if (code !== 0) return code;
  }
  return 0;
}

// 只在作为命令直接运行时执行；被测试 import 时不触发发布。
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) process.exitCode = await run(process.cwd(), process.argv.slice(2));
