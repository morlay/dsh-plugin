import { provide, type ProviderList } from "@morlay/zephyr";
import { SpillLocal } from "./spill-local.service.ts";
import { SpillPolicy } from "./spill-policy.service.ts";
import { ToolResultPruner } from "./tool-result-pruner.service.ts";

// 工具输出这一组：落盘（spill）、落盘策略、结果裁剪。三行都挂在工具调用生命周期上，
// 不是工具本身——契约面是 `ToolRegistry` 与上游的 `spillStore` / `tokenMeter`。
const providers = (): ProviderList => [SpillLocal, SpillPolicy, ToolResultPruner];

export const provideToolOutput = provide(providers());
