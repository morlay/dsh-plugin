import { CLOSED_CODE, DbError } from "../error.ts";

export function closedError(operation: string): DbError {
  return new DbError("closed", `zephyr-rdb: cannot ${operation} on a closed database`, {
    code: CLOSED_CODE,
  });
}

// 一条在飞游标：`close` 释放游标本身（PostgreSQL 的 `pg-cursor`），`release` 交还连接。
// SQLite 是同步句柄，没有游标可关，登记它只为「连接不能在迭代中关」。
export interface InFlightCursor {
  close(): Promise<void>;
  release(): void;
}

// 连接的关闭状态与在飞游标的登记表（两种方言共用，语义在这里定义一次）。
export interface Lifecycle {
  readonly closed: boolean;
  // 新语句 / 新事务的守卫：关闭后立刻抛 `DbError`（`kind: "closed"`）。
  assertOpen(operation: string): void;
  // 标记关闭：此后 `assertOpen` 都失败；在飞迭代的下一次 `next()` 也抛同一个错。
  beginClose(): void;
  // 登记一条在飞游标，返回注销函数（迭代结束时调）。
  register(entry: InFlightCursor): () => void;
  // 关闭全部在飞游标并交还它们的连接（PostgreSQL 的 `pool.end()` 会等连接归还）。
  interruptAll(): Promise<void>;
  // 等在飞游标全部注销（SQLite 用它把 `client.close()` 推迟到迭代退出之后）。
  drain(): Promise<void>;
  pending(): number;
}

export function createLifecycle(): Lifecycle {
  let closed = false;
  const inFlight = new Set<InFlightCursor>();
  let drainWaiters: (() => void)[] = [];

  const settle = (): void => {
    if (inFlight.size > 0 || drainWaiters.length === 0) return;
    const waiters = drainWaiters;
    drainWaiters = [];
    for (const waiter of waiters) waiter();
  };

  const lifecycle: Lifecycle = {
    get closed() {
      return closed;
    },
    assertOpen(operation) {
      if (closed) throw closedError(operation);
    },
    beginClose() {
      closed = true;
    },
    register(entry) {
      inFlight.add(entry);
      return () => {
        inFlight.delete(entry);
        settle();
      };
    },
    async interruptAll() {
      // 先快照：`close()` 期间迭代器可能注销自己，边遍历边改集合会漏掉后面登记的。
      const entries = Array.from(inFlight);
      for (const entry of entries) {
        try {
          await entry.close();
        } catch {
          // 游标已经结束（调用方提前 break）时 close 会拒绝，这里只关心「不再持有」。
        } finally {
          entry.release();
        }
      }
    },
    drain() {
      if (inFlight.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        drainWaiters.push(resolve);
      });
    },
    pending() {
      return inFlight.size;
    },
  };
  return lifecycle;
}
