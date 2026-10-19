// dev 形态的装配差异：用 `@morlay/dsh-client-modules` 替换官方模块表，并停用被它接管的上游行。
// base 的行由入口应用装配；这里只表达差异。
import ClientModuleRegistry from "@deepseek-ai/dsh-client-modules";
import * as ClientHmrPlugin from "@deepseek-ai/dsh-client-hmr";
import * as PluginInventoryPlugin from "@deepseek-ai/dsh-client-ui-settings-plugin-inventory";
import * as PluginsPlugin from "@deepseek-ai/dsh-client-ui-settings-plugins";
import { ClientModulesModule } from "@morlay/dsh-client-modules";
import { Injectable, Module, without } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

// 上游行（禁用目标）：`officialRowId` 决定 patch 里的行 id。
@Injectable()
class UpstreamModulesRow extends fromCordis(ClientModuleRegistry) {
  static readonly officialRowId = "modules";
}

@Injectable()
class UpstreamClientHmrRow extends fromCordis(ClientHmrPlugin) {
  static readonly officialRowId = "client-hmr";
}

@Injectable()
class UpstreamPluginInventoryRow extends fromCordis(PluginInventoryPlugin) {
  static readonly officialRowId = "ui-settings-plugin-inventory";
}

@Injectable()
class UpstreamPluginsRow extends fromCordis(PluginsPlugin) {
  static readonly officialRowId = "ui-settings-plugins";
}

@Module({
  imports: [ClientModulesModule],
  providers: [
    without(UpstreamModulesRow),
    without(UpstreamClientHmrRow),
    without(UpstreamPluginInventoryRow),
    without(UpstreamPluginsRow),
  ],
})
export class WebCustomProfileModule {
  // 本 bundle 停用的 host 行里，哪些 client 行要跟着关：`plugin-manager` 的 host 行不装（profile 由
  // 代码组合），它的 UI 也就不该再去请求 `/api/pluginManager/*`。
  static readonly clientExclude = [
    "@deepseek-ai/dsh-client-ui-plugin-manager",
    // 账号体系在这个形态里没有 host 侧实现：它的设置页留着只会请求不存在的 remote。
    "@deepseek-ai/dsh-client-ui-settings-account",
    // agent-preset 的 UI：本形态只有 mock 的 `standard`，没有预设的编辑/切换面。
    "@deepseek-ai/dsh-client-ui-agent-preset",
    // 上游 `api-remotes` 的 client 半把 plugin-manager / market / registryProbe 也一起挂上；
    // 这条链改由 `@morlay/dsh-client-modules` 的 client 半提供（见 api-remotes.ts）。
    "@deepseek-ai/dsh-api-remotes",
  ] as const;
}
