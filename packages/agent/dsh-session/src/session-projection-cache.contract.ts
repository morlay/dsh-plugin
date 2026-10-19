// sessionProjectionCache 契约：列表页的投影快照读面（只有抽象读面，没有构造与生命周期钩子）。
import type { Session } from "@deepseek-ai/dsh-session";
import type { SessionRecord } from "@deepseek-ai/dsh-session-query";
import type { ProjectionSnapshot } from "@deepseek-ai/dsh-session-projection";
import { Injectable } from "@morlay/zephyr";

type SessionHeader = SessionRecord["header"];

interface SessionProjectionCacheFace {
  cachedSnapshot(meta: SessionHeader, keys?: readonly string[]): ProjectionSnapshot | undefined;
  cachedPredecessorTitle(meta: SessionHeader): ProjectionSnapshot | undefined;
  write?(session: Session): Promise<void>;
}

@Injectable()
export abstract class SessionProjectionCache implements SessionProjectionCacheFace {
  abstract cachedSnapshot(
    meta: SessionHeader,
    keys?: readonly string[],
  ): ProjectionSnapshot | undefined;

  abstract cachedPredecessorTitle(meta: SessionHeader): ProjectionSnapshot | undefined;

  write?(session: Session): Promise<void>;
}
