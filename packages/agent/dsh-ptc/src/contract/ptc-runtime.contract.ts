// PTC 运行时契约：令牌按服务语义命名（上游注册名 `ptcRuntime`）。
import type NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `NodePtcRuntime`（`PtcRuntime` 的 node 实现）的**全部**公开成员，
 * 含基类声明的那些——上游插件按 `ctx.ptcRuntime.<member>` 取用，缺一个就是运行期 `undefined`。
 *
 * `PtcRuntime` 之前是空令牌（只有名字、没有面）：上游是真类，消费方按成员取用，
 * 空面等于「谁用谁崩」。下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type PtcRuntimeCovered = AssertTrue<
  AssertCovered<NodePtcRuntimeService, PtcRuntime>
>;

@Injectable()
export abstract class PtcRuntime {
  abstract readonly executionInstructions: NodePtcRuntimeService["executionInstructions"];

  abstract readonly isolation: NodePtcRuntimeService["isolation"];

  abstract readonly language: NodePtcRuntimeService["language"];

  abstract readonly programFormat: NodePtcRuntimeService["programFormat"];

  abstract readonly release: NodePtcRuntimeService["release"];

  abstract readonly resolve: NodePtcRuntimeService["resolve"];

  abstract readonly run: NodePtcRuntimeService["run"];

  abstract readonly sandboxMode: NodePtcRuntimeService["sandboxMode"];

  abstract readonly timeout: NodePtcRuntimeService["timeout"];

  abstract readonly retainsState: NodePtcRuntimeService["retainsState"];
}
