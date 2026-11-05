// 循环期的**测试支撑**（`@morlay/dsh-agent-loop/testing`）：本仓的装配清单、挂载入口与装配原语。
//
// **不再转出上游 testkit**：它按 cordis 插件逐条 `plugin()`，与本仓的 `ProviderList` 不是一回事。
export { headlessLoopProviders } from "./providers.ts";
export {
  loopTestProviders,
  mountLoopTestDependencies,
  mountLoopTestHarness,
  type Agent,
  type LoopHarness,
  type LoopTestOptions,
} from "./agent-loop-harness.ts";
export { disposeRows, mountProvider, mountProviders, type MountedRow } from "./mount.ts";
export { PresetGroup, PresetLoader } from "./preset-plane.ts";
