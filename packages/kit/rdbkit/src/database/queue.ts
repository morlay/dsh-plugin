/**
 * 写通道串行：同一实例的事务与写语句排队执行（SQLite 是单连接，PG 的 serializable 并发会冲突）。
 * 「当前异步上下文是否已在事务里」由方言层用 `AsyncLocalStorage` 判断（`sqlite.ts` / `postgres.ts`），
 * 这里只提供队列本身。
 */
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

/** 保存点名：只在同一个事务里唯一即可。 */
let savepointCounter = 0;

export function savepointName(): string {
  savepointCounter += 1;
  return `rdbkit_sp_${savepointCounter}`;
}
