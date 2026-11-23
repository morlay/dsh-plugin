// 撤回 / 整段替换之后要让按会话缓存的派生状态失效：投影单元的 cell 缓存与 token-meter 的折叠水位
// 都是**位置**而不是事件身份，截断之后不清就会把重放的事件当成已处理。
import type { Session } from "@morlay/dsh-session/contract";

interface ProjectionRegistryLike {
  registrations?: Map<string, { cells: WeakMap<object, unknown> }>;
}

interface TokenMeterLike {
  states?: WeakMap<object, unknown>;
}

export interface DerivedStateResetDeps {
  projections(): unknown;
  tokenMeter(): unknown;
  warnOnce(key: string, message: string): void;
}

export function resetDerivedState(session: Session, deps: DerivedStateResetDeps): void {
  resetProjectionCells(session, deps);
  resetTokenMeterFold(session, deps);
}

function resetProjectionCells(session: Session, deps: DerivedStateResetDeps): void {
  const registry = deps.projections() as ProjectionRegistryLike | undefined;
  const registrations = registry?.registrations;
  if (!(registrations instanceof Map)) {
    deps.warnOnce(
      "sessionProjections.registrations",
      `session-rdb: sessionProjections.registrations is not a Map (upstream field shape changed); rewind leaves the projection cell caches of "${session.id}" stale, so replayed events can be skipped`,
    );
    return;
  }
  for (const registration of registrations.values()) {
    const cells = registration?.cells;
    if (!(cells instanceof WeakMap)) {
      deps.warnOnce(
        "sessionProjections.cells",
        `session-rdb: sessionProjections registration cells are not a WeakMap (upstream field shape changed); rewind leaves the projection cell caches of "${session.id}" stale`,
      );
      continue;
    }
    cells.delete(session);
  }
}

function resetTokenMeterFold(session: Session, deps: DerivedStateResetDeps): void {
  const meter = deps.tokenMeter() as TokenMeterLike | undefined;
  if (meter === undefined) {
    deps.warnOnce(
      "tokenMeter",
      `session-rdb: tokenMeter is not mounted; after rewind the token-meter fold watermark of "${session.id}" may stay stale, so compaction can report "step/end ... has no matching step/start event"`,
    );
    return;
  }
  const states = meter.states;
  if (!(states instanceof WeakMap)) {
    deps.warnOnce(
      "tokenMeter.states",
      `session-rdb: tokenMeter.states is not a WeakMap (upstream field shape changed); after rewind the token-meter fold watermark of "${session.id}" may stay stale`,
    );
    return;
  }
  states.delete(session);
}
