import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { createSerialQueue, savepointName } from "./queue.ts";
import type { Executor, OpenConfig } from "./types.ts";

// SQLite 连接调优：打开即设 PRAGMA，返回这条连接上的执行面。
export function openSqlite(config: Extract<OpenConfig, { dialect: "sqlite" }>): Executor {
  const client = new DatabaseSync(config.path);
  client.exec("PRAGMA foreign_keys = ON");
  client.exec(`PRAGMA busy_timeout = ${config.busyTimeout ?? 5000}`);
  if (config.cacheSizeKb !== undefined) client.exec(`PRAGMA cache_size = -${config.cacheSizeKb}`);
  if (config.mmapSize !== undefined) client.exec(`PRAGMA mmap_size = ${config.mmapSize}`);
  if (config.journalMode !== undefined && config.applyJournalMode !== false) {
    client.exec(`PRAGMA journal_mode = ${config.journalMode}`);
  }
  const enqueue = createSerialQueue();
  // 当前异步上下文所在的事务（嵌套时共享同一条连接）。
  const current = new AsyncLocalStorage<true>();
  const executor: Executor = {
    async *iterate(text, params) {
      // node:sqlite 的 `iterate` 是同步生成器：逐行读，不把结果集收成数组。
      for (const row of client.prepare(text).iterate(...(params as never[]))) yield row;
    },
    run(text, params) {
      const write = async (): Promise<void> => {
        client.prepare(text).run(...(params as never[]));
      };
      // 事务内的写就是这次事务的一部分；事务外的写先排队，免得落到别人的未提交事务里。
      return current.getStore() === true ? write() : enqueue(write);
    },
    transaction(fn) {
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
      await enqueue(async () => undefined);
      client.close();
    },
  };
  return executor;
}
