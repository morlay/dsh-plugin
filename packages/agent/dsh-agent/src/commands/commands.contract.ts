// 命令注册表契约：令牌按服务语义命名（上游注册名 `commands`）。
import type CommandRuntime from "@deepseek-ai/dsh-commands";
import { Injectable } from "@morlay/zephyr";

interface CommandsFace {
  readonly register: CommandRuntime["register"];
  readonly list: CommandRuntime["list"];
  readonly find: CommandRuntime["find"];
}

@Injectable()
export abstract class Commands implements CommandsFace {
  abstract readonly register: CommandsFace["register"];

  abstract readonly list: CommandsFace["list"];

  abstract readonly find: CommandsFace["find"];
}
