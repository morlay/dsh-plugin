import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types as pgTypes, type PoolClient } from "pg";
import Cursor from "pg-cursor";
import { createSerialQueue, savepointName } from "./queue.ts";
import type { Executor, OpenConfig } from "./types.ts";

/**
 * PostgreSQL 的 `bigint`（int8）与 `numeric` 默认由驱动给字符串。
 *
 * 值是 64 位整数时**不能用 Number 兜**（超过 `2^53` 就悄悄丢精度，`uint64` 的 ID 会撞车），所以：
 * - `int8`（OID 20）→ JS `BigInt`（精确，对应 Go 的 int64 / uint64）；
 * - `numeric`（OID 1700）保持驱动默认的字符串（可能是定点小数，BigInt 也不对）。
 *
 * 业务侧要 number 时自己 `Number(x)`（毫秒时间戳与计数在安全整数内，转换是安全的）。
 */
export function bigintTypes(): {
  getTypeParser: (oid: number, format?: "text" | "binary") => (value: string) => unknown;
} {
  const INT8 = 20;
  return {
    getTypeParser(oid, format) {
      if (oid === INT8) {
        return (value: string) => (value === null ? null : BigInt(value));
      }
      const parser = pgTypes.getTypeParser(oid, format);
      return parser as (value: string) => unknown;
    },
  };
}

/** PostgreSQL 连接池：返回池上的执行面（游标 + int8 → BigInt）。 */
export function openPostgres(config: Extract<OpenConfig, { dialect: "postgres" }>): Executor {
  const pool = new Pool({ connectionString: config.connectionString, types: bigintTypes() });
  const enqueue = createSerialQueue();
  // 当前异步上下文所在的事务连接（嵌套时共享同一条连接，用保存点）。
  const current = new AsyncLocalStorage<PoolClient>();

  // 真游标：按 200 行一批从连接读，调用方提前 break 时释放。
  const cursorRows = async function* (
    client: PoolClient,
    text: string,
    params: readonly unknown[],
  ): AsyncIterable<unknown> {
    const cursor = client.query(new Cursor(text, params as never[]));
    try {
      for (;;) {
        const rows = (await cursor.read(200)) as unknown[];
        if (rows.length === 0) return;
        for (const row of rows) yield row;
      }
    } finally {
      await cursor.close().catch(() => undefined);
    }
  };

  const pooledIterate = async function* (
    text: string,
    params: readonly unknown[],
  ): AsyncIterable<unknown> {
    const client = await pool.connect();
    try {
      yield* cursorRows(client, text, params);
    } finally {
      client.release();
    }
  };

  /** 一条连接上的执行面（顶层事务与嵌套事务共用）。 */
  const scopeOf = (client: PoolClient): Executor => ({
    iterate: (text, params) => cursorRows(client, text, params),
    async run(text, params) {
      await client.query(text, params as never[]);
    },
    transaction(fn) {
      const name = savepointName();
      return (async () => {
        await client.query(`SAVEPOINT ${name}`);
        try {
          const result = await current.run(client, () => fn(scopeOf(client)));
          await client.query(`RELEASE SAVEPOINT ${name}`);
          return result;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
          await client.query(`RELEASE SAVEPOINT ${name}`);
          throw error;
        }
      })();
    },
    async close() {
      // 连接由顶层事务释放，这里什么都不做。
    },
  });

  const executor: Executor = {
    iterate: pooledIterate,
    run(text, params) {
      const client = current.getStore();
      if (client !== undefined) {
        return client.query(text, params as never[]).then(() => undefined);
      }
      return enqueue(async () => {
        await pool.query(text, params as never[]);
      });
    },
    transaction(fn) {
      const held = current.getStore();
      if (held !== undefined) return scopeOf(held).transaction(fn);
      return enqueue(async () => {
        const client = await pool.connect();
        try {
          await client.query(
            config.isolationLevel === undefined
              ? "BEGIN"
              : `BEGIN ISOLATION LEVEL ${config.isolationLevel.toUpperCase()}`,
          );
          const result = await current.run(client, () => fn(scopeOf(client)));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      });
    },
    async close() {
      await enqueue(async () => undefined);
      await pool.end();
    },
  };
  return executor;
}
