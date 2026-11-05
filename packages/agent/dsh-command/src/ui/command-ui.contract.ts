// 命令 UI 的契约（浏览器半）：`/` 命令源、客户端贡献注册表、每会话的弹层控制器。
//
// 实现是上游 `ui-commands` 的 `CommandUiRuntime`（它自己注册成 cordis 服务 `commandUi`）。
// 这里只声明**我们要用的面**——各域的行（权限、模型选择）通过它把 `/permission`、`/model`
// 挂成输入区的弹层贡献。
//
// 没有这个契约时用的是空面（`{ register: () => () => {} }`）：贡献被吞掉，`/model`、`/compress`
// 因此不出现在 `/` 面板里，而调用方也不会报错——静默失效比报错更难查。
import type {
  CommandContribution,
  CommandDecoration,
} from "@deepseek-ai/dsh-client-ui-commands/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class CommandUi {
  /**
   * 登记一条客户端命令贡献（`/model` 的弹层就是这个）。
   * @param contribution - 名字、可用性判断、弹层规格。
   * @returns 撤销函数。
   */
  abstract register(contribution: CommandContribution): () => void;

  /**
   * 给宿主已有的一条命令挂「裸调用时的弹层」（`/permission` 用这个）。
   * @param decoration - 宿主命令名 + 可用性 + 弹层规格。
   * @returns 撤销函数。
   */
  abstract decorate(decoration: CommandDecoration): () => void;

  /**
   * 关掉某条命令的弹层（目录失效时用）。
   * @param name - 命令名（不含斜杠）。
   */
  abstract dismiss(name: string): void;
}
