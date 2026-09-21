import type { SessionId } from "@deepseek-ai/dsh-session";

export class WriteGuard {
  private readonly headSeqs = new Map<SessionId, number>();

  confirmHead(id: SessionId, head: number): void {
    this.headSeqs.set(id, head);
  }

  /** 本实例有没有这条会话的 head 记录（迁移重写用它决定是"登记基准"还是"严格比较"）。 */
  has(id: SessionId): boolean {
    return this.headSeqs.has(id);
  }

  assertNoConcurrentWriter(id: SessionId, storedHead: number): void {
    const known = this.headSeqs.get(id);
    if (known === undefined) {
      if (storedHead !== -1) {
        throw new Error(
          `session "${id}" has a persisted log this instance has not read; another writer may own it — load the session first`,
        );
      }
      return;
    }
    if (known !== storedHead) {
      throw new Error(
        `session "${id}" was modified by another writer (stored head ${storedHead}, this instance last confirmed head ${known}); ` +
          "concurrent writers on one session are not supported",
      );
    }
  }
}
