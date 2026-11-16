// 写通道串行：同一个库上的事务与写语句排队执行（SQLite 是写锁，PG 的 serializable 并发会冲突）。
// 「当前异步上下文是否已在事务里」由方言层用 `AsyncLocalStorage` 判断（`sqlite.ts` / `postgres.ts`）。
export function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

// 进程内的库 → 队列：指向同一个库的多个 `Database` 共用一条队列（键见 `database/library.ts`）。
// 队列本身不带状态，进程退出即消失；跨进程不承诺（那是库自己的锁）。
const queues = new Map<string, <T>(fn: () => Promise<T>) => Promise<T>>();

export function serialQueueFor(library: string): <T>(fn: () => Promise<T>) => Promise<T> {
  const existing = queues.get(library);
  if (existing !== undefined) return existing;
  const queue = createSerialQueue();
  queues.set(library, queue);
  return queue;
}

// 保存点名：只在同一个事务里唯一即可。
let savepointCounter = 0;

export function savepointName(): string {
  savepointCounter += 1;
  return `zephyr_rdb_sp_${savepointCounter}`;
}
