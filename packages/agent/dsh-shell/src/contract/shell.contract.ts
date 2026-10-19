// shell 执行器契约：令牌按服务语义命名（上游注册名 `shell`）。
import type { ShellExecutor as ShellExecutorService } from "@deepseek-ai/dsh-shell";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `ShellExecutor` 的全部公开成员（含 `sandboxMode` getter），与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type ShellExecutorCovered = AssertTrue<AssertCovered<ShellExecutorService, ShellExecutor>>;

@Injectable()
export abstract class ShellExecutor {
  abstract readonly sandboxMode: ShellExecutorService["sandboxMode"];

  abstract readonly resolve: ShellExecutorService["resolve"];

  abstract readonly execute: ShellExecutorService["execute"];
}

