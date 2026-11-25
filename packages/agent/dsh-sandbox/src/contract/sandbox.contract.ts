// 沙箱提供者契约：令牌按服务语义命名（上游注册名 `sandbox`）。
//
// 上游插件按 `ctx.sandbox.<member>` 取用，注入的类型是抽象基类 `SandboxProvider`，
// 所以覆盖守卫对着它核（实现是 `LocalSandboxProvider`，但面以基类为准）。
import { SandboxProvider } from "@deepseek-ai/dsh-sandbox";

/** 能力词汇：一次受限执行要的 argv（程序 + 参数 + cwd），是 `confine` 的入参。 */
export type { ConfinedArgv } from "@deepseek-ai/dsh-sandbox";
import { Injectable } from "@morlay/zephyr";

@Injectable({ name: "sandbox" })
export abstract class Sandbox implements SandboxProvider {
  abstract readonly confine: SandboxProvider["confine"];
}
