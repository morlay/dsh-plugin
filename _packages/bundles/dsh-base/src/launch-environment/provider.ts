// 启动环境提供者：从行 ctx 的槽位读取快照。
import type { Context as CordisContext } from "@deepseek-ai/cordis";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import type { FactoryProvider } from "@morlay/zephyr";
import { LaunchEnvironment } from "./token.ts";

export const LaunchEnvironmentProvider: FactoryProvider<typeof LaunchEnvironment> = {
  provide: LaunchEnvironment,
  useFactory: (ctx) => launchEnvironmentOf(ctx as CordisContext),
};
