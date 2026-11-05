// 上游 ui-commands client 半的**适配基类**（上游归 command 域）。
//
// 上游那一行做三件事（同一个 apply）：注册命令源、把宿主目录与客户端贡献合并成候选、
// 把 command-popup 壳注册进会话输入区的 overlay。三者同源，装整行即可。
//
// 宿主侧（会话界面）的输入区行继承本类、补自己的注入（它要 inputTriggers / sessions 这些**会话域**
// 的端口）。上游的 import 只留在本包：别的域不再直连 @deepseek-ai/dsh-client-ui-commands。
import * as UiCommandsPlugin from "@deepseek-ai/dsh-client-ui-commands/client";
import { fromCordis } from "@morlay/zephyr/compat";
import { CommandUi } from "./command-ui.contract.ts";

/** 命令 UI 行的基类：mount 由基类给出，子类只补注入与 onInit。 */
export class CommandUiRow extends fromCordis(CommandUi, UiCommandsPlugin) {}
