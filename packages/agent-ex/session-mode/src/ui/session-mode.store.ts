// 模式清单与「某个会话当下生效的那一份」的读面：带缓存，失败不缓存（下一次读到就是重试）。
//
// 清单是装配事实（这条行的 config），页面生命周期里不会变；生效态随会话覆盖变，所以按会话缓存。
import { inject, Injectable } from "@morlay/zephyr";
import type { ModeConfig } from "../endpoint/mode-config.ts";
import type { SessionModeActiveState, SessionModeRoster } from "../endpoint/session-mode-shapes.ts";
import { SessionModeEndpointClient } from "./session-mode-endpoint.client.ts";

@Injectable()
export class SessionModeStore {
  private readonly endpoint = inject(SessionModeEndpointClient);

  private roster: Promise<SessionModeRoster> | undefined;

  private readonly actives = new Map<string, Promise<SessionModeActiveState>>();

  // 模式清单（只拉一次；失败作废，下次读就是重试）。
  loadRoster(): Promise<SessionModeRoster> {
    this.roster ??= this.endpoint.roster().catch((error: unknown) => {
      this.roster = undefined;
      throw error;
    });
    return this.roster;
  }

  // 某个会话当下生效的那一份（每次挂载都重拉：会话覆盖可能刚被改过）。
  loadActive(sessionId: string): Promise<SessionModeActiveState> {
    const pending = this.endpoint.active({ sessionId }).catch((error: unknown) => {
      this.actives.delete(sessionId);
      throw error;
    });
    this.actives.set(sessionId, pending);
    return pending;
  }

  // 把某个空白会话切到某个模式。
  async select(sessionId: string, mode: string): Promise<string> {
    const result = await this.endpoint.select({ sessionId, mode });
    this.actives.delete(sessionId);
    return result.mode;
  }

  // 改这个会话的字段覆盖；返回新的生效态。
  async patch(
    sessionId: string,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<SessionModeActiveState> {
    return await this.cache(sessionId, this.endpoint.patch({ sessionId, patch }));
  }

  // 一次性应用整份会话覆盖。
  async applyConfig(sessionId: string, config: ModeConfig): Promise<SessionModeActiveState> {
    return await this.cache(sessionId, this.endpoint.applyConfig({ sessionId, config }));
  }

  // 把草稿写回模式配置（对新会话生效）。
  async saveConfig(sessionId: string, config: ModeConfig): Promise<SessionModeActiveState> {
    const state = await this.cache(sessionId, this.endpoint.saveConfig({ sessionId, config }));
    this.roster = undefined;
    return state;
  }

  // 以当前生效配置另存为新模式。
  async saveAs(sessionId: string, code: string, name?: string): Promise<string> {
    const result = await this.endpoint.saveAs({
      sessionId,
      code,
      ...(name === undefined ? {} : { name }),
    });
    this.roster = undefined;
    return result.mode;
  }

  // 删除当前模式；返回会话回到的那个模式。
  async remove(sessionId: string): Promise<string> {
    const result = await this.endpoint.remove({ sessionId });
    this.roster = undefined;
    this.actives.delete(sessionId);
    return result.mode;
  }

  private async cache(
    sessionId: string,
    pending: Promise<SessionModeActiveState>,
  ): Promise<SessionModeActiveState> {
    const state = await pending;
    this.actives.set(sessionId, Promise.resolve(state));
    return state;
  }
}
