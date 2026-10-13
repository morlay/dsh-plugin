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
  readonly home?: string;
}

interface BundleFlags {
  readonly dir?: boolean;
  readonly install?: boolean;
}

/** 两个形态共用的 dev 选项（数据面根）。 */
const HOME_OPTION =
  "dev data plane: xdg (the packaged home), env (ambient DSH_HOME), or an absolute path " +
  "(default: <workspace>/.dsh-store)";

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
  .option("--home <spec>", HOME_OPTION)
  .argument("[workspace]", "app workspace directory (default: current directory)")
  .action(async (workspace: string | undefined, options: DevFlags) => {
    await runDev({
      workspace: resolveWorkspaceArg(workspace),
      web: true,
      ...(options.home === undefined ? {} : { home: options.home }),
    });
  });

const desktop = program
  .command("desktop")
  .description("launch the Electron shell against the workspace")
  .option("--home <spec>", HOME_OPTION)
  .argument("[workspace]", "app workspace directory (default: current directory)")
  .action(async (workspace: string | undefined, options: DevFlags) => {
    await runDev({
      workspace: resolveWorkspaceArg(workspace),
      web: false,
      ...(options.home === undefined ? {} : { home: options.home }),
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
