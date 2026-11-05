// 按会话收口：一份模式定义落成这个会话的工具面、执行层 guard 与几个抑制面。
import type { Agent } from "@morlay/dsh-agent/contract";
import { Injectable } from "@morlay/zephyr";

// 一次收口的全部输入：模式定义里本域用到的那几项。
export interface SessionScopeDefinition {
  // 拒绝对话时用的模式名。
  readonly name: string;
  // 这个会话能用的工具；留空 = 不设白名单（起点是全部工具）。
  readonly allowTools: readonly string[];
  // 这个会话明确排除的工具（deny 优先）。
  readonly denyTools: readonly string[];
  readonly allowSkills: readonly string[];
  readonly denySkills: readonly string[];
  // 要不要 instruction 类注入（关掉官方工作区指令与通道的降级注入）。
  readonly instructions: boolean;
  // 要不要技能目录（关掉官方 `skill-catalog` 的注入）。
  readonly skills: boolean;
  // 要不要动态快照（沙箱 / 审批策略与时钟注入）。
  readonly runtimeContext: boolean;
  // 这个模式下要丢弃的 system prompt section（精确名，或以 `*` 结尾的前缀）。
  readonly dropSections: readonly string[];
}

// 一份 per-agent 的收回账：`add` 记一笔，`release` 同步、幂等地收干净。
export interface SessionScopeAccount {
  add(stop: () => void): void;
  release(): void;
}

// 一条工具 / 技能在目录里的样子（id + 描述）。
export interface ScopedToolEntry {
  readonly name: string;
  readonly description: string;
}

@Injectable()
export abstract class SessionScope {
  // 一份新的 per-agent 收回账（行卸载与 agent 卸载任一处先到都收干净）。
  abstract account(agent: Agent): SessionScopeAccount;

  // 把某个会话收口到这份定义上（同一个 agent 再调就是换一份）。
  abstract apply(agent: Agent, definition: SessionScopeDefinition): void;

  // 这个会话在模式名单收窄之后"程序内可用"的工具名。
  abstract knownTools(agent: Agent): readonly string[];

  // 全量工具目录：收口那一刻抓的那一份（面板的"工具"折叠组读它）。
  abstract catalogOf(agent: Agent): readonly ScopedToolEntry[];

  // 技能目录：按这个会话的收口与工作目录扫出来的那一份。
  abstract skillCatalog(agent: Agent): Promise<readonly ScopedToolEntry[]>;
}
