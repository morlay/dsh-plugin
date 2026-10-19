// 命令弹层的**状态 store**（浏览器半）：每会话的 open / query / selected / entries，外加动作。
//
// 它只依赖 `endpoint/commands.ts` 里的两个端口（`CommandCatalog` / `CommandRunner`）——实现由组合层
// 绑定（可能是走 remote 的实现，也可能是测试里的假实现），所以这个模块能单独跑起来。
import { inject, Injectable } from "@morlay/zephyr";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { CommandCatalog, CommandRunner } from "@morlay/dsh-command/endpoint";
import type { CommandEntry } from "@morlay/dsh-command/endpoint";

/** 一个会话的命令弹层状态。 */
export interface CommandPaletteState {
  readonly open: boolean;
  readonly query: string;
  readonly selected: number;
  readonly entries: readonly CommandEntry[];
}

const CLOSED: CommandPaletteState = { open: false, query: "", selected: 0, entries: [] };

/** 命令弹层的状态机（视图通过 `useSyncExternalStore` 订阅）。 */
@Injectable()
export class CommandPaletteStore {
  private readonly catalog = inject(CommandCatalog);

  private readonly runner = inject(CommandRunner);

  private readonly listeners = new Set<() => void>();

  private readonly states = new Map<string, CommandPaletteState>();

  /** 一个会话的当前状态（没打开过就是关闭态）。 */
  stateOf(sessionId: string): CommandPaletteState {
    return this.states.get(sessionId) ?? CLOSED;
  }

  /** 订阅状态变化。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 打开弹层（拉一次目录）。 */
  async open(sessionId: string): Promise<void> {
    const entries = await this.catalog.list(SessionId(sessionId));
    this.patch(sessionId, { open: true, query: "", selected: 0, entries });
  }

  /** 关闭弹层。 */
  close(sessionId: string): void {
    this.patch(sessionId, CLOSED);
  }

  /** 改过滤词（选中项回到第一个）。 */
  setQuery(sessionId: string, query: string): void {
    this.patch(sessionId, { query, selected: 0 });
  }

  /** 在过滤后的列表里移动选中项（循环）。 */
  move(sessionId: string, delta: number): void {
    const state = this.stateOf(sessionId);
    const visible = this.visibleOf(state);
    if (visible.length === 0) return;
    this.patch(sessionId, { selected: (state.selected + delta + visible.length) % visible.length });
  }

  /** 过滤后的可见项：空查询给全部，否则按名字与说明做包含匹配。 */
  visibleOf(state: CommandPaletteState): readonly CommandEntry[] {
    const query = state.query.trim().toLowerCase();
    if (query === "") return state.entries;
    return state.entries.filter((entry) =>
      entry.name.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query));
  }

  /** 执行选中项（执行完关闭；没有选中项时只关闭）。 */
  async run(sessionId: string): Promise<void> {
    const state = this.stateOf(sessionId);
    const target = this.visibleOf(state)[state.selected];
    this.close(sessionId);
    if (target === undefined) return;
    await this.runner.run(SessionId(sessionId), target.name);
  }

  private patch(sessionId: string, next: Partial<CommandPaletteState>): void {
    this.states.set(sessionId, { ...this.stateOf(sessionId), ...next });
    // 副本：监听器可能在通知里退订（`Array.from` 就是那份拷贝）。
    for (const listener of Array.from(this.listeners)) listener();
  }
}
