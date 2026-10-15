import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import { DESKTOP_HOST_PACKAGE } from "@morlay/dsh-desktop-shell/official";
import { devRuntimeRoot, requireDevRuntime } from "./dev-layout.ts";
import { prepareShell } from "./shell.ts";
import {
  PROFILE_NAME,
  buildCache,
  desktopConfig,
  findWorkspaceRoot,
  resolveDataDir,
  resolveWorkspace,
  workspaceManifest,
} from "./workspace.ts";

function debugPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`);
  }
  return port;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// dev 形态给子进程注入的 TS 注册：与工作区其它地方同一份（`pnpm-workspace.yaml` 的 `nodeOptions`），
// 即 `@local/oxc-node`。上游包经 exports 指到 src 后，Node 原生 strip-only 不支持
// parameter properties / enum / 装饰器，这一层转译必须挂上。
function tsLoaderSpecifier(): string {
  // `@local/oxc-node`（本仓库的 TS 运行时入口）：注册 hooks + `oxc-transform`，**接管 `node_modules` 下的
  // `.ts`**——整包源码直跑（壳与宿主都在那里），所以这条链要的是它。
  return import.meta.resolve("@local/oxc-node");
}

function withTsLoader(environment: NodeJS.ProcessEnv, loader: string): NodeJS.ProcessEnv {
  return {
    ...environment,
    NODE_OPTIONS: [environment.NODE_OPTIONS, `--import=${loader}`].filter(Boolean).join(" "),
  };
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  environment = process.env,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`desktop development: ${args.join(" ")} exited with ${String(code ?? signal)}`),
        );
    });
  });
}

// web 形态的启动入口住在宿主变体包里（同一套 app-boot）；dev 形态从工作区解析它。
async function webEntry(): Promise<string> {
  const hostRoot = dirname(
    fileURLToPath(import.meta.resolve(`${DESKTOP_HOST_PACKAGE}/package.json`)),
  );
  const entry = join(hostRoot, "src", "web.ts");
  if (!(await pathExists(entry))) {
    throw new Error(`desktop development: missing ${entry}; run the tool build (pnpm build)`);
  }
  return entry;
}

// 源码 client 半「现场打包」那条行的定义只有一份：宿主包里的 overlay（它按相对路径指自己的 `lib/`）。
// 桌面形态由宿主自己挂；web 形态的 profile 就是 app 目录，宿主那层拿不到，所以这里按 `--patch` 挂上。
async function devClientPatch(): Promise<string> {
  // dev 形态的前端装配层（挂 `@morlay/dsh-client-modules`、停上游那几行）由一个 dev-only bundle 提供：
  // web 与桌面两种形态挂的是**同一份** patch。
  const patch = fileURLToPath(import.meta.resolve("@morlay/web-custom-profile/cordis.patch.yml"));
  if (!(await pathExists(patch)))
    throw new Error(`desktop development: missing ${patch}; run the tool build (pnpm build)`);
  return patch;
}

/**
 * 我们这条链是**文件密集**的：客户端资源的预编译按包读源码、算内容指纹（`createHash`）、写产物，dev 形态下
 * 还叠着 vite 的转译与 fs 读——这些全走 libuv 的线程池，而它默认只有 4：并发请求一多就排在池子外面
 * （表现为"明明没在算，请求却卡着"）。**必须在进程启动前**设（运行时改无效），所以在这里注入给由 dshdev
 * 起的每一个进程（壳、宿主、以及它们再拉起的子进程）。用户显式设过就不动。
 */
function threadpoolSize(): string {
  return process.env["UV_THREADPOOL_SIZE"] ?? "64";
}

async function launchElectron(
  appRoot: string,
  profileDir: string,
  runtimeDir: string,
  buildCacheDir: string,
  tsLoader: string,
  dataDir: string,
): Promise<void> {
  const require = createRequire(import.meta.url);
  const electron: unknown = require("electron");
  if (typeof electron !== "string")
    throw new Error("desktop development: electron executable is unavailable");
  const mainPort = debugPort("DSH_DESKTOP_MAIN_INSPECT_PORT", 9229);
  const rendererPort = debugPort("DSH_DESKTOP_RENDERER_DEBUG_PORT", 9222);
  // 9231 而不是 9230：那是上游 `experimental-inspector` 的 Worker 默认端口，桌面档装着那条行时
  // 两者会抢同一个端口，抢输的是整条 inspector 行（Worker 起不来 → 行回滚）。
  const hostPort = debugPort("DSH_DESKTOP_HOST_INSPECT_PORT", 9231);
  const developmentRoot = join(buildCacheDir, "development");
  // 数据面与 `dev --web` 共用工作区 store；只有浏览器数据留在构建目录里。
  const userData = join(developmentRoot, "electron-user-data");

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    UV_THREADPOOL_SIZE: threadpoolSize(),
    // **壳必须是真 Electron**：`ELECTRON_RUN_AS_NODE` 会让它退化成一个 node 进程，于是
    // `--remote-debugging-port` / `--user-data-dir` 这类 Chromium 开关全被当成 bad option，壳根本起不来。
    // （这个变量在环境里很常见——它本来是给"把 Electron 当 node 用"的子进程准备的。）
    ELECTRON_RUN_AS_NODE: undefined,
    DSH_HOME: dataDir,
    // 两格分工：`PROFILE_DIR` 是 profile root（app 目录本身），`RUNTIME_DIR` 是安装根
    // （官方闭包、前端产物与 host 载荷的来源）。
    DSH_DESKTOP_DEV_PROFILE_DIR: profileDir,
    DSH_DESKTOP_DEV_RUNTIME_DIR: runtimeDir,
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),

    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? "1",
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1",
  };
  console.log(`desktop development: DSH_HOME=${dataDir}`);
  console.log(`desktop development: profile root=${profileDir} runtime=${runtimeDir}`);
  console.log(
    `desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`,
  );
  await run(
    electron,
    [
      `--inspect=127.0.0.1:${String(mainPort)}`,
      `--remote-debugging-port=${String(rendererPort)}`,
      `--user-data-dir=${userData}`,
      // dev 形态的壳跑在**开发机**上（不是产品形态，`bundle` 那条路不经过这里）：受限会话（容器、
      // 远程 shell、CI）里 Chromium 的沙箱与 GPU 进程常常起不来——报 `sandbox initialization failed`
      // 之后 GPU 连环崩、最后 SIGTRAP。要保留沙箱就设 `DSH_DESKTOP_SANDBOX=1`。
      ...(process.env["DSH_DESKTOP_SANDBOX"] === "1" ? [] : ["--no-sandbox", "--disable-gpu"]),
      appRoot,
    ],
    appRoot,
    environment,
  );
}

export interface DevOptions {
  readonly workspace?: string;
  readonly web: boolean;
  /**
   * 先用**打包形态的解析面**装配一遍再起（`--prod`）：跑 `pnpm deploy` 的闭包 + profile 清单，
   * 然后拿它当 profile/runtime。价值是"不打包也能验证打包形态"——闭包内容、profile 清单、依赖解析
   * 面与真打包完全一致，而不必先等一次 electron-builder。
   */
  readonly prod?: boolean;
  // 数据目录（`$DSH_HOME`）：缺省是 profileDir 下的 `.dsh-store`，取值语义见 `resolveDataDir`。
  readonly dataDir?: string;
}

/**
 * `--prod` 的装配面：seed 的布局就是打包形态的布局（`<buildCache>/seed/{runtime,profiles/<name>}`），
 * 复用生成它的那条链，别再写一遍。
 */
async function prepareProdSurface(
  workspace: string,
): Promise<{ profileDir: string; runtimeDir: string }> {
  // **只做 deploy**：deploy 目录里已有 `package.json` 与 `node_modules`（含 `.pnpm` 虚拟店），解析根要的东西
  // 齐了——拿它同时当 profileDir 与 runtimeDir 就闭环。以前这里跑整条 `runPrepareSeed`（官方闭包、profile
  // 清单、typert 生成物、壳装配、seed 布局），那是**打包形态**才需要的阶段，验证解析面纯属浪费时间。
  const { prepareDeploySurface } = await import("./prepare-seed.ts");
  const surface = await prepareDeploySurface(workspace);
  return { profileDir: surface, runtimeDir: surface };
}

export async function runDev(options: DevOptions): Promise<void> {
  const workspace = resolve(options.workspace ?? resolveWorkspace());
  const repositoryRoot = await findWorkspaceRoot(workspace);
  const manifest = await workspaceManifest(workspace);
  const buildCacheDir = buildCache(workspace);
  // 两种 dev 形态共用同一个数据目录；`--data-dir=xdg` 时与打包形态落到同一个位置。
  const dataDir = resolveDataDir(workspace, manifest.name, options.dataDir);
  const runtimeDir = devRuntimeRoot(repositoryRoot);
  // `--prod`：先装配"打包形态的解析面"（deploy 闭包 + profile 清单），再照常起——闭包内容、profile
  // 清单、依赖解析面与真打包一致，于是**不打包**也能验证打包形态。seed 的布局就是打包形态的布局。
  const prod = options.prod === true ? await prepareProdSurface(workspace) : undefined;
  const activeRuntimeDir = prod?.runtimeDir ?? runtimeDir;
  if (prod === undefined) await requireDevRuntime(runtimeDir);
  // 壳装配到打包工作目录（`.dshdev/shell`）：源码树里那份 `dist` 不再被 dev 依赖。
  const shell = await prepareShell(buildCacheDir);
  const tsLoader = tsLoaderSpecifier();

  if (options.web) {
    // web 形态的 profile 就是 app 目录：清单来自 app 的 `package.json`，bundle 由工作区链接解析，
    // 因此没有 `plugin add`、也没有 `$DSH_HOME/profiles/web`。端口契约（`PORT`，缺省 3080）与
    // 内层参数归 web 入口：它把 `--` 之后原样交给 web app 的 flag family。
    //
    // `--prod` 时 profile 换成 seed 里那份（含 profile bundles），前端装配也在那里，所以**不挂** dev
    // 形态那份 `--patch`。
    const profileRoot = prod?.profileDir ?? workspace;
    console.log(
      `desktop development: web mode${prod === undefined ? "" : " (prod surface)"} ` +
        `DSH_HOME=${dataDir} profile root=${profileRoot}`,
    );
    await run(
      process.execPath,
      [
        await webEntry(),
        "--profile-dir",
        profileRoot,
        "--runtime-dir",
        activeRuntimeDir,
        ...(prod === undefined ? ["--patch", await devClientPatch()] : []),
      ],
      repositoryRoot,
      withTsLoader(
        {
          ...process.env,
          DSH_HOME: dataDir,
          UV_THREADPOOL_SIZE: threadpoolSize(),
          // profile 根也要从 env 传一份：这条链的"解析根/缓存根"（client-modules 的 `resolutionRoot`）
          // 是拿它算的，只给 `--profile-dir` 参数的话 web 形态那边看不到（桌面形态由壳注入同一个变量）。
          DSH_DESKTOP_DEV_PROFILE_DIR: profileRoot,
          // 形态标志：dev 形态要标（这条链的"根在哪"与预编译策略都看它）。`--prod` **不标**——它要跑的
          // 就是打包形态那一套（联邦预编译、`dev.exclude` 之外的包按包产出），标了会退回 dev 的逐文件策略，
          // 于是"验证打包形态"就落空了。
          ...(prod === undefined ? { DSH_DEV_FORM: "web" } : {}),
        },
        tsLoader,
      ),
    );
    return;
  }

  const desktop = desktopConfig(manifest);
  const runtimeRoot = join(buildCacheDir, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeAppConfig(runtimeRoot, {
    name: manifest.name,
    displayName: desktop.displayName,
    id: desktop.id,
    version: desktop.version,
    dataDir: dataDir,
    window: desktop.window,
    profile: PROFILE_NAME,
  });

  await launchElectron(shell.root, prod?.profileDir ?? workspace, activeRuntimeDir, buildCacheDir, tsLoader, dataDir);
}
