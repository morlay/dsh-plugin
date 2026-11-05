import type { ProviderList } from "@morlay/zephyr";
import { provideAgent } from "../agent.provide.ts";

/**
 * headless 层的最小清单：只装骨架（目录 / 模型 / 提示词 / 工具注册表）。
 *
 * 不含 `AppEnv`（部署事实由调用方给）、不含 wire（`./server`）、不含循环期（`dsh-agent-loop`）。
 * @returns 条目清单。
 */
export function headlessAgentProviders(): ProviderList {
  return [...provideAgent()];
}
