import { access, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { writeAppConfig, type AppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import { buildDesktopApp } from "./electron-builder.ts";
import { prepareIcons } from "./icon.ts";
import { runPrepareRuntime } from "./prepare-runtime.ts";
import { runPrepareSeed } from "./prepare-seed.ts";
import { buildShell, SHELL_PACKAGE_ROOT } from "./shell.ts";
import {
  PROFILE_NAME,
  buildRoot,
  desktopConfig,
  resolveWorkspace,
  workspaceManifest,
} from "./workspace.ts";

export interface BundleOptions {
  readonly workspace?: string;
  readonly dir: boolean;
  readonly install: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface InstallPlanInput {
  readonly platform: NodeJS.Platform;

  readonly artifacts: string;

  readonly home: string;

  readonly name: string;

  readonly displayName: string;

  readonly localAppData?: string;
}

/** Linux 启动器条目：显示名给人看，文件名与 `Exec` 用包名。 */
export interface DesktopEntry {
  readonly path: string;
  readonly contents: string;
}

export interface InstallPlan {
  readonly source: string;

  readonly target: string;

  readonly copySymlinksVerbatim: boolean;

  readonly desktopEntry?: DesktopEntry;
}

// mac 的 `.app` 名由 electron-builder 从 `productName`（显示名）派生，非法字符会被它替换——所以在这里认领
// 产物目录里那一个 `.app`，不重写一遍它的命名规则（重写就会与产物名失配）。
async function macAppBundle(artifacts: string): Promise<string> {
  const dir = join(artifacts, "mac-arm64");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
  const bundles = (entries ?? [])
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => join(dir, entry.name));
  const only = bundles[0];
  if (only === undefined || bundles.length !== 1) {
    throw new Error(`desktop bundle: missing built application in ${dir}`);
  }
  return only;
}

/**
 * Where one platform's built artifacts go, and how. The names split by role: the display name is what a person
 * sees (macOS `.app`, Linux menu entry), the package name stays the file-system identity (Linux target directory
 * and executable, Windows program directory) — the executable must match electron-builder's
 * `linux.executableName`, which is the workspace package name.
 * @param input - target platform, artifact root, home directory, and both names.
 * @returns the copy source/target pair plus the Linux launcher entry, when the platform has one.
 * @throws when the platform is unsupported or its build produced no usable application bundle.
 */
export async function installPlan(input: InstallPlanInput): Promise<InstallPlan> {
  const { platform, artifacts, home, name, displayName } = input;
  if (platform === "darwin") {
    return {
      source: await macAppBundle(artifacts),
      target: join("/Applications", `${displayName}.app`),
      copySymlinksVerbatim: true,
    };
  }
  if (platform === "linux") {
    const target = join(home, ".local", "lib", name);
    return {
      source: join(artifacts, "linux-unpacked"),
      target,
      copySymlinksVerbatim: false,
      desktopEntry: {
        path: join(home, ".local", "share", "applications", `${name}.desktop`),
        contents: [
          "[Desktop Entry]",
          "Type=Application",
          `Name=${displayName}`,
          `Exec=${join(target, name)}`,
          "Terminal=false",
          "",
        ].join("\n"),
      },
    };
  }
  if (platform === "win32") {
    const localAppData = input.localAppData ?? join(home, "AppData", "Local");
    return {
      source: join(artifacts, "win-unpacked"),
      target: join(localAppData, "Programs", name),
      copySymlinksVerbatim: false,
    };
  }
  throw new Error(`desktop bundle: unsupported platform ${platform}`);
}

async function installApp(workspace: string, appConfig: AppConfig): Promise<void> {
  const plan = await installPlan({
    platform: process.platform,
    artifacts: join(buildRoot(workspace), "artifacts"),
    home: homedir(),
    name: appConfig.name,
    displayName: appConfig.displayName,
    ...(process.env.LOCALAPPDATA === undefined ? {} : { localAppData: process.env.LOCALAPPDATA }),
  });
  if (!(await pathExists(plan.source))) {
    throw new Error(`desktop bundle: missing built application ${plan.source}`);
  }
  await rm(plan.target, { recursive: true, force: true });
  await cp(plan.source, plan.target, {
    recursive: true,
    verbatimSymlinks: plan.copySymlinksVerbatim,
  });
  if (plan.desktopEntry !== undefined) {
    await mkdir(dirname(plan.desktopEntry.path), { recursive: true });
    await writeFile(plan.desktopEntry.path, plan.desktopEntry.contents);
  }
  console.log(
    `desktop bundle: installed ${plan.target}${plan.desktopEntry === undefined ? "" : " with desktop entry"}`,
  );
}

export async function runBundle(options: BundleOptions): Promise<void> {
  const workspace = resolve(options.workspace ?? resolveWorkspace());
  const manifest = await workspaceManifest(workspace);
  const buildRootDir = buildRoot(workspace);
  const desktop = desktopConfig(manifest);
  const appConfig: AppConfig = {
    name: manifest.name,
    displayName: desktop.displayName,
    id: desktop.id,
    version: desktop.version,
    dshHome: desktop.dshHome,
    window: desktop.window,
    profile: PROFILE_NAME,
  };

  console.log(
    `desktop bundle: workspace ${workspace} (${appConfig.displayName}@${appConfig.version})`,
  );
  await buildShell();
  await runPrepareRuntime({ workspace });
  await runPrepareSeed({ workspace });

  const icons = await prepareIcons(workspace, buildRootDir, desktop.icon);

  await mkdir(join(buildRootDir, "runtime"), { recursive: true });
  await writeAppConfig(join(buildRootDir, "runtime"), appConfig);

  await buildDesktopApp({
    appRoot: SHELL_PACKAGE_ROOT,
    buildRoot: buildRootDir,
    appConfig,
    icons,
    dir: options.dir,
  });
  console.log(`desktop bundle: artifacts in ${join(buildRootDir, "artifacts")}`);
  if (options.install) await installApp(workspace, appConfig);
}
