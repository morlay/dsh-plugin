// shell 执行器契约：令牌按服务语义命名（上游注册名 `shell`）。
import { Injectable } from "@morlay/zephyr";
import { ShellExecutor as ShellExecutorService } from "@deepseek-ai/dsh-shell";

@Injectable({ name: "shell" })
export abstract class ShellExecutor implements ShellExecutorService {
  abstract readonly sandboxMode: ShellExecutorService["sandboxMode"];

  abstract readonly resolve: ShellExecutorService["resolve"];

  abstract readonly execute: ShellExecutorService["execute"];
}
