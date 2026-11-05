import { provide } from "@morlay/zephyr";
import { CommandEndpointClient } from "./command-endpoint-client.ts";
import { CommandPaletteStore } from "./command-palette.store.ts";
import { CommandRemoteBinding } from "./command-remote.binding.ts";
import { RemoteCommandCatalog } from "./remote-command-catalog.ts";
import { RemoteCommandRunner } from "./remote-command-runner.ts";

/**
 * command 的浏览器半：RPC 客户端 + 目录/执行器的远端实现 + 命令 UI 行 + 弹层的 store 与视图。
 *
 * 顺序 = 依赖：端点客户端先（其余都经它走 wire）；`commands` 的 namespace 面（`CommandRemoteBinding`）
 * 要排在消费方之前——上游 `ui-commands` 的 `static inject` 里有 `remote.commands`（那一行在
 * `dsh-session` 的输入区组里装，因为它的头一项依赖是 `inputTriggers`）。
 */
export const provideCommandUi = provide([
  CommandEndpointClient,
  CommandRemoteBinding,
  RemoteCommandCatalog,
  RemoteCommandRunner,
  CommandPaletteStore,
]);
