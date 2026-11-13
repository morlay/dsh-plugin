// 沙箱策略契约：令牌按服务语义命名（上游注册名 `sandboxPolicy`）。
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

// 能力词汇：策略本身（模式与可写根）、它的求值结果与路径规范化。上游 `@deepseek-ai/dsh-sandbox`
// 既出端口也出这些值，这里只取「策略」那半边——消费方按策略判放行，不必自己引上游。
/** 沙箱模式的三个档（read-only / workspace-write / danger-full-access）。 */
export type { SandboxMode } from "@deepseek-ai/dsh-sandbox";
/** 一次求值后的执行策略：模式 + 可写根 + 追加根。 */
export type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
/**
 * `SandboxPolicy.resolve()` 的结果：一次求值后的策略值（不是服务，是那份数据）。
 *
 * 名字带 `Resolved` 是因为 `SandboxPolicy` 这个名字已经被本包的策略端口占了：两者是
 * 「服务」与「它算出来的值」的区别，不是两份实现。
 */
export type ResolvedSandboxPolicy = ReturnType<SandboxPolicy["resolve"]>;
/** 把路径规范化成策略比对用的形态（纯函数）。 */
export { canonicalPath } from "@deepseek-ai/dsh-sandbox";
/** 策略允许写的根目录列表（纯函数）。 */
export { writableRoots } from "@deepseek-ai/dsh-sandbox";

/**
 * 契约面：上游 `SandboxPolicyService` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SandboxPolicyCovered = AssertTrue<AssertCovered<SandboxPolicyService, SandboxPolicy>>;

@Injectable()
export abstract class SandboxPolicy {
  abstract readonly defaultMode: SandboxPolicyService["defaultMode"];

  abstract readonly workspaceRoot: SandboxPolicyService["workspaceRoot"];

  abstract readonly resolve: SandboxPolicyService["resolve"];

  abstract readonly overrideOf: SandboxPolicyService["overrideOf"];

  abstract readonly additionalWritableRoots: SandboxPolicyService["additionalWritableRoots"];

  /** 运行期追加一个可写根（返回撤销它自己的 disposer）。 */
  abstract readonly registerWritableRoot: SandboxPolicyService["registerWritableRoot"];
}
