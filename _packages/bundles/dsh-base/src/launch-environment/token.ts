// 启动环境槽位值（`LaunchEnvironment`）：插件注入它，不直接碰 ctx 槽位。
import type { LaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import { InjectionToken } from "@morlay/zephyr";

export const LaunchEnvironment = new InjectionToken<LaunchEnvironmentSnapshot | undefined>(
  "launchEnvironment",
);
