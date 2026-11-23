// 读视图转换的 home：读一次日志之后要做的全部归一与修复（顺序即语义）。
//
// 三块各管一件事：surface（区间与溯源）、shape（旧代形状）、inbox（孤儿拼接）。
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { repairSurfaceOps, recomputeReplaceProvenance, syncMeteringRanges } from "./surface.ts";
import { repairAssistantSettlement, repairRequestHeaders, renameLegacyPtcEvents } from "./shape.ts";
import { repairOrphanInboxSplices } from "./inbox.ts";

/**
 * 把存储行读出来的事件修成当前形状（就地修改）。
 * @param events - 事件序列（按 seq 有序）。
 */
export function repairReadView(events: SessionEvent[]): void {
  repairAssistantSettlement(events);
  repairRequestHeaders(events);
  renameLegacyPtcEvents(events);
  repairSurfaceOps(events);
  syncMeteringRanges(events);
  recomputeReplaceProvenance(events);
  repairOrphanInboxSplices(events);
}

export * from "./surface.ts";
export * from "./shape.ts";
export * from "./inbox.ts";
