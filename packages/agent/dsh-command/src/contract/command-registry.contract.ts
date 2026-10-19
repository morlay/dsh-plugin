// 命令**注册表**的契约：只回答「谁能登记一条命令」。
//
// 查询与执行不在它上面——只读面是 `CommandCatalog`（某会话能看见什么），执行面是 `CommandRunner`。
// 宿主侧要按 agent 读/执行（上游 `list(agent)` / `find(agent, name)` / `execute(agent, …)`）时用
// 实现类 `CommandRegistryDefault`（本包 `server/` 内部），不从契约面把它们放出来。
import { Injectable } from "@morlay/zephyr";
import type { CommandContribution } from "./command-contribution.ts";

@Injectable()
export abstract class CommandRegistry {
  /** 登记一条命令；返回**这一条**的撤销函数（`@Command()` 生成的登记在行卸载时调它）。 */
  abstract register(contribution: CommandContribution): () => void;
}
