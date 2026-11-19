// 契约名对上游：本包契约类的 `@Injectable({ name })` 必须等于上游 `super(ctx, '<name>')` 的注册名。
//
// 名字写错的后果是静默的：装配期按别名发布的那一份与上游按名字读的那一份对不上，消费方拿到
// `undefined` 再从别处报错。期望值抄自上游源码（`vendor/deepseek-harness/packages/…`，逐行注明），
// 不由被测代码推导——否则判据就被实现带着走。
import {
  AgentDefaultModel,
  AgentDirectory,
  DeepseekLlmApiExtensions,
  Llm,
  SubagentRegistry,
  SystemPrompt,
  ToolRegistry,
  WorkingDirectory,
} from "@morlay/dsh-agent/contract";
import { tokenMetaOf } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

/** 表：契约类 → 上游注册名（`super(ctx, '…')` 的第一个参数；设施类的 `provide('…')` 同义）。 */
const contractNames: ReadonlyArray<readonly [object, string]> = [
  // @deepseek-ai/dsh-subagent  subagent/subagent/src/index.ts:210
  [SubagentRegistry, "subagents"],
  // @deepseek-ai/dsh-tools  core/tools/src/index.ts:112
  [ToolRegistry, "tools"],
  // @deepseek-ai/dsh-agent  core/agent/src/index.ts:260
  [AgentDirectory, "agents"],
  // @deepseek-ai/dsh-working-directory  session/working-directory/src/index.ts:92
  [WorkingDirectory, "workingDirectory"],
  // @deepseek-ai/dsh-llm  llm/llm/src/index.ts:378
  [Llm, "llm"],
  // @deepseek-ai/dsh-agent-default-model  core/agent-default-model/src/index.ts:58
  [AgentDefaultModel, "agentDefaultModel"],
  // @deepseek-ai/dsh-deepseek-llm-api-extensions  llm/deepseek-llm-api-extensions/src/index.ts:72
  [DeepseekLlmApiExtensions, "deepseekLlmApiExtensions"],
  // @deepseek-ai/dsh-system-prompt  core/system-prompt/src/index.ts:453
  [SystemPrompt, "systemPrompt"],
];

describe("契约名对上游注册名", () => {
  for (const [contract, expected] of contractNames) {
    it(`${(contract as { readonly name: string }).name} → ${expected}`, () => {
      expect(tokenMetaOf(contract).alias).toBe(expected);
    });
  }
});
