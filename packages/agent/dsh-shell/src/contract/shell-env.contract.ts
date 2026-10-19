// shell 环境契约：令牌按服务语义命名（上游注册名 `shellEnv`）。
import { ShellEnvRegistry } from "@deepseek-ai/dsh-shell-env";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `ShellEnvRegistry` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type ShellEnvCovered = AssertTrue<AssertCovered<ShellEnvRegistry, ShellEnv>>;

@Injectable()
export abstract class ShellEnv {
  abstract readonly register: ShellEnvRegistry["register"];

  abstract readonly collect: ShellEnvRegistry["collect"];

  abstract readonly list: ShellEnvRegistry["list"];
}

