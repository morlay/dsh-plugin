// 默认模型契约：令牌按服务语义命名（上游注册名 `agentDefaultModel`）。
import type AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

/**
 * 能力词汇：模型选择的投影定义（`modelSelection` 的纯 fold）：登记到 `sessionProjections` 就有这一面。
 *
 * 上游把它放在 `@deepseek-ai/dsh-agent` 的 model-selection 模块里；这里与「默认选哪个模型」放在一处，
 * 因为两者是同一件事的两半（一个是会话里的选择，一个是没有选择时的默认）。
 */
export { modelSelectionProjectionDefinition } from "@deepseek-ai/dsh-agent";

/**
 * 契约面：上游 `AgentDefaultModelConfig` 的**全部**公开成员。
 *
 * 成员一个都不能少——上游插件按 `ctx.agentDefaultModel.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 * 覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type AgentDefaultModelCovered = AssertTrue<
  AssertCovered<AgentDefaultModelConfig, AgentDefaultModel>
>;

@Injectable()
export abstract class AgentDefaultModel {
  abstract readonly currentSelection: AgentDefaultModelConfig["currentSelection"];

  abstract readonly saveSelection: AgentDefaultModelConfig["saveSelection"];
}
