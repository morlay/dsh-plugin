// 默认模型契约：令牌按服务语义命名（上游注册名 `agentDefaultModel`）。
import type AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

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

