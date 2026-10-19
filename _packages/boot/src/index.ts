// `@morlay/dsh-app-boot`：按 profile 装配并启动一次应用的那一层。
//
// 替代上游 `@deepseek-ai/dsh/profile-boot`（它在 vendor 里那个 **private** 的 `@deepseek-ai/dsh`/`apps/cli`
// 包内，外部装不到）：组合与外壳自研，装配本身仍用公开的 `@deepseek-ai/dsh-app-boot`。这样我们这条链不再
// 依赖那个应用包，而"层序 / 服务面 / 生命周期"归我们自己掌控。
//
// 用法见 [`README.md`](../README.md)，设计见
// [`自研 app-boot`](../.agents/designs/20261015-自研-app-boot（切开-dsh-依赖）.md)。

export {
  bootAppProfile,
  installAnchorOf,
  type AppProfileBoot,
  type AppProfileOptions,
} from "./app-profile.ts";
export {
  PROFILE_ROOT_FILENAME,
  runProfile,
  type ResolvedProfile,
  type RunProfileOptions,
} from "./profile-boot.ts";
export {
  PROCESS_SHUTDOWN_TIMEOUT_MS,
  createProcessShutdown,
  type ProcessShutdown,
} from "./process-shutdown.ts";
