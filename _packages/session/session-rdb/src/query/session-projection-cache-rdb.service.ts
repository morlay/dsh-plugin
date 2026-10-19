// `sessionProjectionCache` 的 rdb 实现：列表页要的 `title` 投影直接来自 `t_sessions.f_title`。
// 上游那套是「一份 per-record KV + 写穿 checkpoint」，rdb 部署里标题本来就在会话表上，不必再存一份。
// `cachedSnapshot` 是**同步** API（列表不能等 IO）：`onInit` 里把 id→title 读进内存。
import type { SessionRecord } from "@deepseek-ai/dsh-session-query";
import type { ProjectionSnapshot } from "@deepseek-ai/dsh-session-projection";
import { SessionProjectionCache } from "@morlay/dsh-base/session-projection";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { RdbController } from "../persistence/rdb-controller.ts";

type SessionHeader = SessionRecord["header"];

@Injectable()
export class SessionProjectionCacheRdb extends SessionProjectionCache {

  rdb = inject(RdbController);

  private readonly titles = new Map<string, string>();

  async onInit(_ctx: Context): Promise<void> {

    try {
      const { items } = await this.rdb.backend.listSessionRows({ limit: 100_000, offset: 0 });
      for (const row of items) {
        if (row.title !== null && row.title.length > 0) this.titles.set(row.sessionId, row.title);
      }
    } catch (error) {
      // 没有 rdb 控制面的装配（单测的纯 backend、或占位实例）：标题就走「没有投影」的分支。
    }
  }

  cachedSnapshot(header: SessionHeader): ProjectionSnapshot | undefined {
    const title = this.titles.get(String(header.id));
    return title === undefined
      ? undefined
      : { asOfSeq: 0 as ProjectionSnapshot["asOfSeq"], values: { title } };
  }

  cachedPredecessorTitle(): undefined {
    return undefined;
  }
}
