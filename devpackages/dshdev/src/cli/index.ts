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
  readonly dataDir?: string;
}

interface BundleFlags {
  readonly dir?: boolean;
  readonly install?: boolean;
}

/**
 * 两个形态共用的数据面选项：**数据目录**（`$DSH_HOME`，放 `logs/` 与会话库那些）。
 *
 * 缺省是 `<profileDir>/.dsh-store`（dev 的 profileDir 就是工作区）；给了值就按 `dshHome` 的三态解析
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
  .argument("[workspace]", "app workspace directory (default: current directory)")
  .action(async (workspace: string | undefined, options: DevFlags) => {
    await runDev({
      workspace: resolveWorkspaceArg(workspace),
      web: true,
      ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    });
  });

const desktop = program
  .command("desktop")
  .description("launch the Electron shell against the workspace")
  .option("--data-dir <spec>", DATA_DIR_OPTION)
  .argument("[workspace]", "app workspace directory (default: current directory)")
  .action(async (workspace: string | undefined, options: DevFlags) => {
    await runDev({
      workspace: resolveWorkspaceArg(workspace),
      web: false,
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

await program.parseAsync(process.argv);
