import { randomUUID } from "node:crypto";
import { SessionId } from "@morlay/dsh-session/contract";
import type { SessionEvent } from "@morlay/dsh-session/contract";
import { SessionBranchError, type BranchAnchorMode } from "@morlay/better-session/endpoint";

export function assertRewindBoundary(
  id: SessionId,
  toBoundary: number,
  boundaryType: string | undefined,
  head: number,
): void {
  if (toBoundary === -1) return;
  if (toBoundary > head) {
    throw new SessionBranchError(
      `rewind boundary ${toBoundary} is beyond the stored head ${head}`,
      "INVALID_BOUNDARY",
    );
  }
  if (boundaryType === undefined) {
    throw new SessionBranchError(
      `rewind boundary ${toBoundary} does not exist in session "${id}"`,
      "INVALID_BOUNDARY",
    );
  }
  if (boundaryType !== "turn/end" && boundaryType !== "user/message") {
    throw new SessionBranchError(
      `rewind boundary ${toBoundary} is not a turn/end or user/message (${boundaryType})`,
      "INVALID_BOUNDARY",
    );
  }
}

export function locateTurnEnd(
  events: readonly SessionEvent[],
  atSeq?: number,
  mode: BranchAnchorMode = "after",
): number {
  const ends = events.filter((event) => event.type === "turn/end").map((event) => event.seq);
  if (atSeq === undefined) {
    const last = ends.at(-1);
    if (last === undefined) throw new SessionBranchError("session has no closed turn", "OPEN_TURN");
    return last;
  }
  if (mode === "before") {
    let boundary = -1;
    for (const seq of ends) {
      if (seq < atSeq) boundary = seq;
      else break;
    }
    return boundary;
  }
  const firstAfter = ends.find((seq) => seq >= atSeq);
  if (firstAfter !== undefined) return firstAfter;

  const lastStart = [...events].reverse().find((event) => event.type === "turn/start");
  if (lastStart !== undefined && lastStart.seq <= atSeq) {
    throw new SessionBranchError(`anchor ${atSeq} lies inside an open turn`, "OPEN_TURN");
  }
  const last = ends.at(-1);
  if (last === undefined) throw new SessionBranchError("session has no closed turn", "OPEN_TURN");
  return last;
}

export function renumber(events: readonly SessionEvent[], offset: number): SessionEvent[] {
  return events.map((event, index) => ({ ...event, seq: offset + index }) as SessionEvent);
}

export function mintSessionId(): SessionId {
  return SessionId(`session-${randomUUID()}`);
}
