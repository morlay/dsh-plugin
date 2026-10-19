// 沙箱提供者契约：令牌按服务语义命名（上游注册名 `sandbox`）。
//
// 上游插件按 `ctx.sandbox.<member>` 取用，注入的类型是抽象基类 `SandboxProvider`，
// 所以覆盖守卫对着它核（实现是 `LocalSandboxProvider`，但面以基类为准）。
import { SandboxProvider } from "@deepseek-ai/dsh-sandbox";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SandboxProvider` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SandboxCovered = AssertTrue<AssertCovered<SandboxProvider, Sandbox>>;

@Injectable()
export abstract class Sandbox {
  abstract readonly confine: SandboxProvider["confine"];
}

