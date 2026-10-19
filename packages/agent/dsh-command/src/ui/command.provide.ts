import { provide } from "@morlay/zephyr";
import { CommandEndpointClient } from "./command-endpoint-client.ts";
import { CommandPaletteStore } from "./command-palette.store.ts";
import { CommandPaletteView } from "./command-palette.view.tsx";
import { RemoteCommandCatalog } from "./remote-command-catalog.ts";
import { RemoteCommandRunner } from "./remote-command-runner.ts";

/**
 * command 的浏览器半：RPC 客户端 + 目录/执行器的远端实现 + 命令弹层的 store 与视图。
 *
 * 顺序 = 依赖：端点客户端先（其余都经它走 wire），目录/执行器次之，弹层最后。
 */
export const provideCommandUi = provide([
  CommandEndpointClient,
  RemoteCommandCatalog,
  RemoteCommandRunner,
  CommandPaletteStore,
  CommandPaletteView,
]);
