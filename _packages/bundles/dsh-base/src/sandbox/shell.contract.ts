// shell 执行器契约：令牌按服务语义命名（上游注册名 `shell`）。
import type { ShellExecutor as ShellExecutorService } from "@deepseek-ai/dsh-shell";
import { Injectable } from "@morlay/zephyr";

interface ShellExecutorFace {
  readonly resolve: ShellExecutorService["resolve"];
  readonly execute: ShellExecutorService["execute"];
}

@Injectable()
export abstract class ShellExecutor implements ShellExecutorFace {
  abstract readonly resolve: ShellExecutorFace["resolve"];

  abstract readonly execute: ShellExecutorFace["execute"];
}
