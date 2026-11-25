// shell 环境契约：令牌按服务语义命名（上游注册名 `shellEnv`）。
import { ShellEnvRegistry } from "@deepseek-ai/dsh-shell-env";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

@Injectable({ name: "shellEnv" })
export abstract class ShellEnv {
  abstract readonly register: ShellEnvRegistry["register"];

  abstract readonly collect: ShellEnvRegistry["collect"];

  abstract readonly list: ShellEnvRegistry["list"];
}

/**
 * 覆盖守卫（严格）：上游 `ShellEnvRegistry` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type ShellEnvCovered = AssertTrue<AssertCoveredStrict<ShellEnvRegistry, ShellEnv>>;
