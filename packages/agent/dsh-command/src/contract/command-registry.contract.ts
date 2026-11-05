// 命令**注册表**的契约：只回答「谁能登记一条命令」。
//
// 查询与执行不在它上面——只读面是 `CommandCatalog`（某会话能看见什么），执行面是 `CommandRunner`。
// 宿主侧要按 agent 读/执行（上游 `list(agent)` / `find(agent, name)` / `execute(agent, …)`）时用
// 实现类 `CommandRegistryDefault`（本包 `server/` 内部），不从契约面把它们放出来。
import type { CommandFileReceiptResolver } from "@deepseek-ai/dsh-commands";
import { Injectable } from "@morlay/zephyr";
import type { CommandContribution } from "./command-contribution.ts";

@Injectable()
export abstract class CommandRegistry {
  /** 登记一条命令；返回**这一条**的撤销函数（`@Command()` 生成的登记在行卸载时调它）。 */
  abstract register(contribution: CommandContribution): () => void;

  /**
   * 命令提交里「暂存文件回执」的唯一解析方（会话上传方装它，提交时按 id 换回附件引用）。
   *
   * 它和 `register` 是同一族：都是往注册表里**装一个面**。漏了它，上传行拿到的是空壳，
   * 报错落在 `ctx.commands.registerFileReceiptResolver is not a function`（离这里很远）。
   */
  abstract registerFileReceiptResolver(resolver: CommandFileReceiptResolver): () => void;
}
