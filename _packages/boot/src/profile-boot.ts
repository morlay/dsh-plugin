// 一次 profile 启动的**组合与外壳**：算 patch 栈 → 挂树 → 提交 ready → 交回生命周期。
//
// 这一层原先在上游那个 private 的 `@deepseek-ai/dsh`（`apps/cli` 的 `./profile-boot`）里，我们依赖它只为这一
// 个子出口。装配本身（读清单、bundle 层、patch 解析、Loader 启动）继续用上游 `@deepseek-ai/dsh-app-boot`；
// 自研的是"怎么把它们串起来"：层序、要 provide 的服务面、fail-loud 与有界退出。

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FiberState, type Context } from "@deepseek-ai/cordis";
import {
  auditStartupEntries,
  boot,
  createRuntimeResolution,
  installFailLoud,
  loadOverlayPatches,
  PluginPackages,
  readProfilePatches,
  type Profile,
  type ProfileContext,
} from "@deepseek-ai/dsh-app-boot";
import { provideCmdline, type AppReady } from "@deepseek-ai/dsh-cmdline";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { installProxyFromEnvironment } from "@deepseek-ai/dsh-http-proxy";
import {
  DSH_LAUNCH_ENVIRONMENT_KEY,
  type LaunchEnvironmentSnapshot,
} from "@deepseek-ai/dsh-launch-environment";
import { createProcessShutdown, type ProcessShutdown } from "./process-shutdown.ts";

const NAME = "dsh";

/** 根配置的文件名（profile 目录内）。 */
export const PROFILE_ROOT_FILENAME = "cordis.yml";

// 每个 profile 的树都 patch 在这份**空入口表**上：真正的组合是 patch 层（各 bundle 的、profile 自己的、
// `--patch` 的）。每次启动重写：Loader 在插件自销毁时会把当前树写回，留下就会在下次启动把这些行重复一遍。
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;

/** 启动方自带的 profile 与它的解析锚点：应用自己就知道 profile 在哪，不必让 boot 去猜。 */
export interface ResolvedProfile {
  /** 已加载好的 profile（清单与各 bundle 层都在里面）。 */
  readonly profile: Profile;
  /** 解析官方包的锚点清单路径——完整闭包就在 profile 里，锚点即 profile 的 `package.json`。 */
  readonly installAnchor: string;
}

/** {@link runProfile} 的输入。 */
export interface RunProfileOptions {
  /** 本次启动冻结的环境快照：任何入口挂载之前就定下。 */
  readonly environment: LaunchEnvironmentSnapshot;
  /** profile 名（`desktop` / `web`）：给配置里的按名门控行用。 */
  readonly profile: string;
  /** 启动方自带的 profile 与锚点。 */
  readonly resolvedProfile: ResolvedProfile;
  /** `--patch` overlay 文件，按 argv 顺序。 */
  readonly patchFiles: readonly string[];
  /** 这次调用的内层参数，经 `ctx.cmdlineArgs` 交给树。 */
  readonly args: readonly string[];
  /** 应用自己的包操作通道（插件页的安装/卸载）。 */
  readonly packageManager?: ProfileContext["packageManager"];
}

/** 启动器自己的就绪位：boot 与宿主准备都成功之后才提交。 */
function createAppReady(): { service: AppReady; commit(): void } {
  let ready = false;
  const listeners = new Set<() => void>();
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener();
          return () => {};
        }
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    commit() {
      if (ready) return;
      ready = true;
      for (const listener of listeners) listener();
      listeners.clear();
    },
  };
}

/**
 * 端到端启一次 profile：patch 栈是「bundle 层（清单顺序）→ profile 自己的 `cordis.patch.yml` → `--patch`」，
 * 树挂在 profile 的空根配置上；进程存活交给挂上去的插件（或一次性 runner）。
 * @param options - 环境快照、profile 与其锚点、overlay、内层参数。
 * @returns 落定的根上下文与关停控制器。
 * @throws 启动失败时先收尾再抛出（收尾也失败则聚合成一条错误）。
 */
export async function runProfile(
  options: RunProfileOptions,
): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  // 第一个插件挂载之前、任何请求发出之前：Node 的 fetch 不认代理环境变量，不装代理每个 profile 都会直连。
  // 从启动快照解析而不是 `process.env`，这样 `.env` 层里声明的代理也生效。
  const disposeProxy = await installProxyFromEnvironment(options.environment, (message) => {
    process.stderr.write(`${NAME}: ${message}\n`);
  });

  const { profile, installAnchor } = options.resolvedProfile;
  const app: { current?: Context } = {};
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> =>
    (disposal ??= (async () => {
      const failures: unknown[] = [];
      for (const release of [() => app.current?.fiber.dispose(), disposeProxy]) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "dsh: profile cleanup failed");
    })());
  try {
    // 根配置每次启动重写（见 `PROFILE_ROOT_CONFIG` 上的说明），再算运行时解析与 overlay。
    await writeFile(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);
    const resolution = await createRuntimeResolution({ installAnchor, profile });
    const overlays = options.patchFiles.flatMap((file) => loadOverlayPatches(NAME, resolve(file)));

    const appReady = createAppReady();
    const shutdown = createProcessShutdown(dispose);
    const signalShutdown = new AbortController();
    const interrupt = (code: number): void => {
      signalShutdown.abort();
      shutdown.interrupt(code);
    };
    // 信号在整个启动窗口内都归自己管，不只是 boot() 落定之后：被 insert 的 provider 可能先发布，
    // 兄弟行还没挂完。SIGTERM 是supervisor 的普通停止请求（退 0），SIGINT 是用户中断（退 130）。
    process.on("SIGTERM", () => {
      interrupt(0);
    });
    process.on("SIGINT", () => {
      interrupt(130);
    });
    installFailLoud(NAME, process, async () => {
      await app.current?.fiber.dispose();
    });

    const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME);
    const profileContext: ProfileContext = {
      name: options.profile,
      ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager }),
      dir: profile.dir,
      patchPath: profile.patchPath,
      installAnchor,
      startedBundles: profile.layers.map((layer) => layer.packageName),
      cwd: process.cwd(),
      home: resolveDshHome(),
      overlays,
      telemetryDisabledEnv: process.env["DSH_TELEMETRY_DISABLED"],
    };
    const ctx = await boot(
      NAME,
      rootConfig,
      readProfilePatches(NAME, profileContext, profile),
      async (hostCtx) => {
        app.current = hostCtx;
        hostCtx.provide("profileContext", profileContext);
        // 任何配置树入口挂载之前：让插件从同一份不可变快照解析所有启动期环境值。
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);
        await hostCtx.plugin(PluginPackages, { resolution });
        provideCmdline(hostCtx, {
          args: options.args,
          exit: (code) => void shutdown.shutdown(code),
          ready: appReady.service,
        });
      },
    );
    // 启动审计：上游默认只打一行汇总（`N entry did not activate`），排查"某行为什么没起"时不够用——
    // 这里把它的完整诊断（每个未激活行的 outcome：kind / error / phase）原样写进日志。
    await auditStartupEntries(ctx, NAME, (line) => {
      process.stderr.write(`${NAME}: ${line}\n`);
    });
    app.current = ctx;
    if (
      !signalShutdown.signal.aborted &&
      ctx.fiber.state === FiberState.ACTIVE &&
      ctx.get("loader") !== undefined
    ) {
      appReady.commit();
    }
    return { ctx, shutdown };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "dsh: profile startup and cleanup failed");
    }
    throw error;
  }
}
