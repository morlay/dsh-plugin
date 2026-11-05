// 会话模式的契约：模式清单、按会话的选择、把一份模式定义落到这个会话上（收口）。
// 只列**有调用方**的成员：wire 端点（`./server` 的 `SessionModeEndpointDefault`）、收口与子代理候选、
// 以及 `tool-guidance` 的注入判据。内部用得到的读面（如默认模型）走实现类，不上契约。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { Session } from "@morlay/dsh-session/contract";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import { Injectable } from "@morlay/zephyr";
import type { ModeConfig, SessionModeRole } from "../endpoint/mode-config.ts";
import type {
  SessionModeActiveState,
  SessionModePatch,
  SessionModeRoster,
  SessionModeRow,
} from "../endpoint/session-mode-shapes.ts";

// 两端共用的角色声明归 `./endpoint`，这里只转出（一处一个 home）。
export type { SessionModeRole } from "../endpoint/mode-config.ts";

// 三个注入开关的补丁：`null` = 清掉这一项的会话覆盖。
export type SessionModeSwitchPatch = Readonly<
  Partial<Record<"instructions" | "skills" | "runtimeContext", boolean | null>>
>;

// `name` 是上游服务名别名：源包与上游别的行按 `ctx.sessionModes` 读这一份。
@Injectable({ name: "sessionModes" })
export abstract class SessionMode {
  // 新会话用它。
  abstract readonly defaultId: string;

  // 选择器要的清单（只列 `main` 角色）。
  abstract list(): SessionModeRow[];

  // 声明了某个角色的模式 id（顺序即清单插入序）：`main` 给选择器，`subagent` 给子代理候选。
  abstract idsFor(role: SessionModeRole): string[];

  // 同 `idsFor`，给的是定义——「指定 mode」那条接缝要拿候选集。
  abstract modesFor(role: SessionModeRole): { id: string; mode: ModeConfig }[];

  // 清单 + 默认模式（wire 的 `sessionMode/roster`）。
  abstract roster(): SessionModeRoster;

  // 按 id 取定义；未知 id 抛。
  abstract definition(id?: string): ModeConfig;

  // 会话当前模式的完整定义（`modeOf` 的展开）。
  abstract modeOfSession(session: Session): ModeConfig;

  // 会话自己选过的模式（没选过是 `null`：回落部署默认不算「选过」）。
  abstract selectedOf(session: Session): string | null;

  // 会话当前模式（投影上有就用它，否则部署默认）。
  abstract modeOf(session: Session): string;

  // 这个会话还能不能换模式（空白窗口）：服务端拒绝与 client chip 的只读形态都读它。
  abstract editableOf(session: Session): boolean;

  // 这个会话在模式名单收窄之后"程序内可用"的工具名（`tool-guidance` 的注入判据）。
  abstract knownToolsOf(agent: Agent): readonly string[];

  // preset → 模式的反查：只在唯一时回答（模式声明了 `presetsOnly` 且本部署那个 preset 在其中时）。
  abstract modeForPreset(preset: string | undefined): string | undefined;

  // 把某个空白会话切到某个模式（wire 的 `sessionMode/select`）。
  abstract select(sessionId: SessionId, mode: string): Promise<string>;

  // 把某个活着的 agent 切到某个模式（子代理继承走这里）。
  abstract applyTo(agent: Agent, mode: string, options?: { record?: boolean }): void;

  // 某个会话**当下生效**的一份（面板读它）。
  abstract activeState(sessionId: SessionId): Promise<SessionModeActiveState | undefined>;

  // 改这个会话的字段覆盖（`null` 清掉该字段）。
  abstract setModePatch(
    sessionId: SessionId,
    patch: SessionModePatch,
  ): Promise<SessionModeActiveState | undefined>;

  // 改这个会话的三个注入开关。
  abstract setSwitches(
    sessionId: SessionId,
    patch: SessionModeSwitchPatch,
  ): Promise<SessionModeActiveState | undefined>;

  // 一次性应用整份会话覆盖（面板的"应用到会话"）。
  abstract applyConfig(
    sessionId: SessionId,
    config: ModeConfig,
  ): Promise<SessionModeActiveState | undefined>;

  // 把草稿写回模式配置（面板的"保存为默认"）。
  abstract saveConfig(
    sessionId: SessionId,
    config: ModeConfig,
  ): Promise<SessionModeActiveState | undefined>;

  // 把当前会话的覆盖写回这个模式。
  abstract saveAsDefault(sessionId: SessionId): Promise<SessionModeActiveState | undefined>;

  // 以当前会话的生效配置另存为一个新模式（面板的"另存为"弹窗给 code 与显示名）；返回新 id。
  abstract saveAsNewMode(sessionId: SessionId, code: string, name?: string): Promise<string>;

  // 删除一个"另存为"出来的模式；返回会话回到的那个模式 id。
  abstract deleteMode(sessionId: SessionId): Promise<string>;
}
