// 装配面：宿主 + 客户端行 + 能力模块，全部走 `@Module`（入口只 `imports`，不直接塞 providers）。
import { Module, configuredProvider, type ModuleClass } from "@morlay/zephyr";
import {
  ApiGatewayModule,
  LoggerExporterModule,
  TypertModule,
  RemoteAccessModule,
  AppEnvDefault,
  ClientModulesModule,
  ClientRowsDefault,
  ConnectionModule,
  WebModule,
} from "@morlay/zephyr-app";
import { CredentialsDefault } from "@morlay/dsh-auth";
import { StorageModule } from "@morlay/dsh-storage";
import { SessionModule, SessionProjectionModule } from "@morlay/dsh-session";
import { AgentModule } from "@morlay/dsh-agent";
import { LlmModule } from "@morlay/dsh-agent";
import { ToolRowsModule } from "@morlay/dsh-agent/tool";
import { resolve } from "node:path";

const appRoot = process.cwd();
// 路径只在装配面算一次：`AppEnv.dataDir` 与各层的子目录都从它拼，避免两处硬编码漂移。
const dataDir = resolve(appRoot, ".dsh-store");

/** 入口模块：`rows` 是运行时推导的结果（`clientPackagesOf` 在入口先算好再传进来）。 */
export function customWebModuleOf(rows: readonly string[]): ModuleClass {
  @Module({
  imports: [
    WebModule,
    ConnectionModule,
    TypertModule,
    RemoteAccessModule,
    ApiGatewayModule,
    LoggerExporterModule,
    ClientModulesModule,
    SessionModule,
    SessionProjectionModule,
    LlmModule,
    AgentModule,
    ToolRowsModule,
  ],
  providers: [
    // dsh-auth 只导出 Provider、没有 Module 封装。
    CredentialsDefault,
    // 路径全部在这里显式给（不读环境变量、不向上找目录）：启动器在 `apps/dsh-custom-next`。
    configuredProvider(AppEnvDefault, {
      // cwd 就是解析根（`just web` 在仓库根/启动器目录跑，node 的解析链从它出发）。
      profileDir: appRoot,
      dataDir,
      dev: true,
      aggregate: [
        "@deepseek-ai/*"
      ],
    }),
    configuredProvider(ClientRowsDefault, rows),
    // 存储根目录显式给（路径只从 AppEnv 的 dataDir 派生）。
    ...StorageModule.withConfig(resolve(dataDir, "storages")),
  ],
  })
  class CustomWebModule {}
  return CustomWebModule;
}
