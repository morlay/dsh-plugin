// `sessionMode` 组的宿主实现：把契约方法转发到 `SessionMode` 服务，并注册到 wire。
import type { Agent } from "@morlay/dsh-agent/contract";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { inject, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteGroup, registerRemoteGroup } from "@morlay/zephyr-app/remote";
import { SessionMode } from "../contract/session-mode.contract.ts";
import { SessionScope } from "../contract/session-scope.contract.ts";
import {
  SessionModeEndpoint,
  type SessionModeApplyConfigRequest,
  type SessionModeOfRequest,
  type SessionModePatchRequest,
  type SessionModeSaveAsRequest,
  type SessionModeSaveAsValue,
  type SessionModeSaveConfigRequest,
  type SessionModeSelectRequest,
  type SessionModeSelectValue,
} from "../endpoint/session-mode-endpoint.ts";
import type {
  SessionModeActiveState,
  SessionModeCatalogValue,
  SessionModeRoster,
} from "../endpoint/session-mode-shapes.ts";

// 会话不在场时 wire 回的失败：形状固定，客户端按 message 显示。
function missing(sessionId: string): Error {
  return new Error(`会话不存在：${sessionId}`);
}

@RemoteGroup()
export class SessionModeEndpointDefault extends SessionModeEndpoint implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly modes = inject(SessionMode);

  private readonly scope = inject(SessionScope);

  private readonly directory = inject(AgentDirectory);

  onInit(): void {
    registerRemoteGroup(this.handlers, this);
  }

  override async roster(): Promise<SessionModeRoster> {
    return this.modes.roster();
  }

  override async active(request: SessionModeOfRequest): Promise<SessionModeActiveState> {
    const state = await this.modes.activeState(SessionId(request.sessionId));
    if (state === undefined) throw missing(request.sessionId);
    return state;
  }

  override async select(request: SessionModeSelectRequest): Promise<SessionModeSelectValue> {
    return { mode: await this.modes.select(SessionId(request.sessionId), request.mode) };
  }

  override async patch(request: SessionModePatchRequest): Promise<SessionModeActiveState> {
    const state = await this.modes.setModePatch(SessionId(request.sessionId), request.patch);
    if (state === undefined) throw missing(request.sessionId);
    return state;
  }

  override async applyConfig(
    request: SessionModeApplyConfigRequest,
  ): Promise<SessionModeActiveState> {
    const state = await this.modes.applyConfig(SessionId(request.sessionId), request.config);
    if (state === undefined) throw missing(request.sessionId);
    return state;
  }

  override async saveConfig(
    request: SessionModeSaveConfigRequest,
  ): Promise<SessionModeActiveState> {
    const state = await this.modes.saveConfig(SessionId(request.sessionId), request.config);
    if (state === undefined) throw missing(request.sessionId);
    return state;
  }

  override async saveAsDefault(request: SessionModeOfRequest): Promise<SessionModeActiveState> {
    const state = await this.modes.saveAsDefault(SessionId(request.sessionId));
    if (state === undefined) throw missing(request.sessionId);
    return state;
  }

  override async saveAs(request: SessionModeSaveAsRequest): Promise<SessionModeSaveAsValue> {
    return {
      mode: await this.modes.saveAsNewMode(
        SessionId(request.sessionId),
        request.code,
        request.name,
      ),
    };
  }

  override async remove(request: SessionModeOfRequest): Promise<SessionModeSelectValue> {
    return { mode: await this.modes.deleteMode(SessionId(request.sessionId)) };
  }

  override async catalog(): Promise<SessionModeCatalogValue> {
    const tools = new Set<string>();
    const skills = new Set<string>();
    for (const agent of this.directory.list()) {
      for (const tool of this.scope.catalogOf(this.agentOf(agent))) tools.add(tool.name);
      for (const skill of await this.scope.skillCatalog(this.agentOf(agent)))
        skills.add(skill.name);
    }
    return { tools: [...tools], skills: [...skills] };
  }

  // 目录里的条目就是 agent 本身（上游 `AgentRegistry.list()` 给实例）。
  private agentOf(agent: Agent): Agent {
    return agent;
  }
}
