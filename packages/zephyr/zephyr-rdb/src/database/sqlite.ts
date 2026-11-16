import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { createLifecycle } from "./lifecycle.ts";
import { sqliteLibraryKey } from "./library.ts";
import { savepointName, serialQueueFor } from "./queue.ts";
import type { Executor, ExecutorOptions, OpenConfig } from "./types.ts";

// SQLite 连接调优：打开即设 PRAGMA，返回这条连接上的执行面。
export function openSqlite(config: Extract<OpenConfig, { dialect: "sqlite" }>): Executor {
  const client = new DatabaseSync(config.path);
  try {
    client.exec("PRAGMA foreign_keys = ON");
    client.exec(`PRAGMA busy_timeout = ${config.busyTimeout ?? 5000}`);
    if (config.cacheSizeKb !== undefined) client.exec(`PRAGMA cache_size = -${config.cacheSizeKb}`);
    if (config.mmapSize !== undefined) client.exec(`PRAGMA mmap_size = ${config.mmapSize}`);
    if (config.journalMode !== undefined && config.applyJournalMode !== false) {
      client.exec(`PRAGMA journal_mode = ${config.journalMode}`);
    }
  } catch (error) {
    // 打开失败的调用方拿不到 executor，也就没人能关这个句柄：这里必须自己收尾。
    client.close();
    throw error;
  }
  // 写队列按库身份共享：同进程里指向同一文件的多个 `Database` 不会同时写。
  const enqueue = serialQueueFor(sqliteLibraryKey(config.path));
  // 当前异步上下文所在的事务（嵌套时共享同一条连接）。
  const current = new AsyncLocalStorage<true>();
  const lifecycle = createLifecycle();
  // 关闭是「延迟关」：在飞迭代还拿着连接，等它们退出后再 `client.close()`（不在迭代中关连接）。
  const closedOnce = { value: false };
  const closeClient = (): void => {
    if (closedOnce.value) return;
    closedOnce.value = true;
    client.close();
  };
  // 语句级开关：这条语句要按 BigInt 读整数列时打开（INTEGER 列由归一退回 number）。
  const prepare = (
    text: string,
    options?: ExecutorOptions,
  ): ReturnType<DatabaseSync["prepare"]> => {
    const statement = client.prepare(text);
    if (options?.readBigInts === true) statement.setReadBigInts(true);
    return statement;
  };
  const executor: Executor = {
    async *iterate(text, params, options) {
      lifecycle.assertOpen("iterate");
      const release = lifecycle.register({
        close: async () => undefined,
        release: () => undefined,
      });
      try {
        const statement = prepare(text, options);
        for (const row of statement.iterate(...(params as never[]))) {
          // 关闭后下一次 next() 抛带 code 的 DbError，而不是驱动裸错。
          lifecycle.assertOpen("iterate");
          yield row;
        }
      } finally {
        release();
      }
    },
    write(text, params, options) {
      lifecycle.assertOpen("write");
      const run = async (): Promise<unknown[]> => {
        lifecycle.assertOpen("write");
        return prepare(text, options).all(...(params as never[])) as unknown[];
      };
      // 事务内的写就是这次事务的一部分；事务外的写与 `run` 同队串行。
      return current.getStore() === true ? run() : enqueue(run);
    },
    run(text, params) {
      lifecycle.assertOpen("run");
      const run = async (): Promise<void> => {
        lifecycle.assertOpen("run");
        client.prepare(text).run(...(params as never[]));
      };
      // 事务内的写就是这次事务的一部分；事务外的写先排队，免得落到别人的未提交事务里。
      return current.getStore() === true ? run() : enqueue(run);
    },
    transaction(fn) {
      lifecycle.assertOpen("transaction");
      if (current.getStore() === true) {
        // 嵌套：同一条连接上的保存点，内层失败只回滚内层。
        return (async () => {
          const name = savepointName();
          client.exec(`SAVEPOINT ${name}`);
          try {
            const result = await current.run(true, () => fn(executor));
            client.exec(`RELEASE SAVEPOINT ${name}`);
            return result;
          } catch (error) {
            client.exec(`ROLLBACK TO SAVEPOINT ${name}`);
            client.exec(`RELEASE SAVEPOINT ${name}`);
            throw error;
          }
        })();
      }
      return enqueue(async () => {
        lifecycle.assertOpen("transaction");
        client.exec("BEGIN IMMEDIATE");
        try {
          const result = await current.run(true, () => fn(executor));
          client.exec("COMMIT");
          return result;
        } catch (error) {
          client.exec("ROLLBACK");
          throw error;
        }
      });
    },
    async close() {
      // 幂等：第二次直接返回（调用方在打开失败后关两次是安全的）。
      if (lifecycle.closed) return;
      lifecycle.beginClose();
      await enqueue(async () => undefined);
      if (lifecycle.pending() === 0) {
        closeClient();
        return;
      }
      // 不在这里等：close() 立即返回，连接留到在飞迭代退出后关（不在迭代中关连接）。
      void lifecycle.drain().then(closeClient);
    },
  };
  return executor;
}
