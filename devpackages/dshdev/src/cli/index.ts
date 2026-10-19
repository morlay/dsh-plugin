#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { runBundle } from "./bundle.ts";
import { runDev } from "./dev.ts";

const APP_ROOT = resolve(import.meta.dirname, "..", "..");

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(resolve(APP_ROOT, "package.json"), "utf8")) as {
    version?: string;
  };
  return manifest.version ?? "0.0.0";
}

function resolveWorkspaceArg(workspace: string | undefined): string {
  const resolved = resolve(workspace ?? process.cwd());
  process.env.DSH_DESKTOP_WORKSPACE = resolved;
  return resolved;
}

interface DevFlags {
  readonly profileDir?: string;
  readonly dataDir?: string;
  readonly prod?: boolean;
}

interface BundleFlags {
  readonly dir?: boolean;
  readonly install?: boolean;
}

/**
 * 两个形态共用的数据面选项：**数据目录**（`$DSH_HOME`，放 `logs/` 与会话库那些）。
 *
 * 缺省是 `<profileDir>/.dsh-store`（dev 的 profileDir 就是工作区）；给了值就按 `dataDir` 的三态解析
 * （与打包形态同一份规则，见 [design](./../.agents/designs/20261014-数据与工作目录的-layout.md)）。
 */
const DATA_DIR_OPTION =
  "data directory ($DSH_HOME: logs, sessions…): xdg (the packaged data dir), env (ambient " +
  "DSH_HOME), or an absolute path (default: <profile-dir>/.dsh-store)";

const program = new Command();

program
  .name("dshdev")
  .description(
    "run and package a dsh workspace: `web` (browser), `desktop` (Electron shell), `desktop bundle` (static app)",
  )
  .version(await packageVersion());

program
  .command("web")
  .description("boot the workspace as `dsh web` in the browser")
  .option("--data-dir <spec>", DATA_DIR_OPTION)
  .option(
    "--prod",
    "assemble the packaged surface first (pnpm deploy closure + profile manifests) and boot against it",
  )
  .option(
    "--profile-dir <dir>",
    "boot this profile root instead of the workspace / the --prod deploy surface (for comparing against a packaged profile)",
  )
  .argument("[workspace]", "app workspace directory (default: current directory)")
  .action(async (workspace: string | undefined, options: DevFlags) => {
    await runDev({
      workspace: resolveWorkspaceArg(workspace),
      web: true,
      ...(options.prod === true ? { prod: true } : {}),
      ...(options.profileDir === undefined ? {} : { profileDir: options.profileDir }),
      ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    });
  });

const desktop = program
  .command("desktop")
  .description("launch the Electron shell against the workspace")
  .option("--data-dir <spec>", DATA_DIR_OPTION)
  .option(
    "--prod",
    "assemble the packaged surface first (pnpm deploy closure + profile manifests) and boot against it",
  )
  .option(
    "--profile-dir <dir>",
    "boot this profile root instead of the workspace / the --prod deploy surface (for comparing against a packaged profile)",
  )
  .argument("[workspace]", "app workspace directory (default: current directory)")
  .action(async (workspace: string | undefined, options: DevFlags) => {
    await runDev({
      workspace: resolveWorkspaceArg(workspace),
      web: false,
      ...(options.prod === true ? { prod: true } : {}),
      ...(options.profileDir === undefined ? {} : { profileDir: options.profileDir }),
      ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    });
  });

desktop
  .command("bundle")
  .description("build a static, unsigned desktop application for the current platform")
  .option("--dir", "produce an unpacked application directory (no installer)")
  .option("--install", "install the built application into the platform application directory")
  .argument("[workspace]", "app workspace directory (default: current directory)")
  .action(async (workspace: string | undefined, options: BundleFlags) => {
    await runBundle({
      workspace: resolveWorkspaceArg(workspace),
      dir: options.dir === true,
      install: options.install === true,
    });
  });

program
  .command("check-deps")
  .description(
    "scan a package's runtime imports (from its entry) and report the ones that cannot resolve",
  )
  .argument("[package]", "package directory (default: current directory)")
  .action(async (pkg: string | undefined) => {
    const { reportRuntimeDependencies } = await import("./runtime-deps.ts");
    // **单包视角**：批量交给 `pnpm -r exec dshdev check-deps`，这里不扫全仓。
    const missing = await reportRuntimeDependencies(
      pkg === undefined ? process.cwd() : resolve(pkg),
    );
    if (missing.length > 0) process.exitCode = 1;
  });

program
  .command("check-locale")
  .description(
    "check the faces only `dsh.bundle` packages need: locale exports, published files, en/zh titles",
  )
  .argument("[root]", "repository root (default: current directory)")
  .action(async (root: string | undefined) => {
    const { reportLocaleFaces } = await import("./check-locale.ts");
    const problems = await reportLocaleFaces(root);
    for (const problem of problems) process.stderr.write(`[check-locale] ${problem}\n`);
    if (problems.length > 0) process.exitCode = 1;
  });

program
  .command("check-docs")
  .description(
    "check documentation references, markdown links and the glossary registry (a lint tool, not a test)",
  )
  .argument("[root]", "repository root (default: current directory)")
  .action(async (root: string | undefined) => {
    const { checkGlossary, checkMarkdownLinks, checkReferences } =
      await import("@local/devkit/checks");
    const repositoryRoot = resolve(root ?? process.cwd());
    const problems = [
      ...(await checkReferences(repositoryRoot)),
      ...(await checkMarkdownLinks(repositoryRoot)),
      ...(await checkGlossary(repositoryRoot)),
    ];
    for (const problem of problems) process.stderr.write(`[check-docs] ${problem}\n`);
    if (problems.length > 0) process.exitCode = 1;
  });

program
  .command("manifest")
  .description(
    "write back the manifest in the current directory (exports + the dsh version requirement) for a data package that has no source entry",
  )
  .action(async () => {
    const { runManifest } = await import("./manifest.ts");
    await runManifest();
  });

program
  .command("publish")
  .description(
    "publish the package in the current directory if its version is new (CI step; don't run locally)",
  )
  .option("--registry <url>", "registry to publish to (default: GitHub Packages)")
  .option("--branch <name>", "branch recorded in the published manifest")
  .action(async (options: { registry?: string; branch?: string }) => {
    const { runPublish } = await import("./publish.ts");
    const status = await runPublish({
      ...(options.registry === undefined ? {} : { registry: options.registry }),
      ...(options.branch === undefined ? {} : { branch: options.branch }),
    });
    if (status !== 0) process.exitCode = status;
  });

program
  .command("login")
  .description("write the publish token into ~/.npmrc (CI step; don't run locally)")
  .action(async () => {
    const { runLogin } = await import("./login.ts");
    const status = await runLogin();
    if (status !== 0) process.exitCode = status;
  });

await program.parseAsync(process.argv);
