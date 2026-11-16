import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types as pgTypes, type PoolClient } from "pg";
import Cursor from "pg-cursor";
import { canceledError } from "../error.ts";
import { closedError, createLifecycle } from "./lifecycle.ts";
import { postgresLibraryKey } from "./library.ts";
import { savepointName, serialQueueFor } from "./queue.ts";
import type { Executor, ExecutorOptions, OpenConfig } from "./types.ts";

// PostgreSQL 的 `bigint`（int8）与 `numeric` 默认由驱动给字符串。
//
// 值是 64 位整数时**不能用 Number 兜**（超过 `2^53` 就悄悄丢精度，`uint64` 的 ID 会撞车），所以：
// - `int8`（OID 20）→ JS `BigInt`（精确，对应 Go 的 int64 / uint64）；
// - `numeric`（OID 1700）保持驱动默认的字符串（可能是定点小数，BigInt 也不对）。
//
// 业务侧要 number 时自己 `Number(x)`（毫秒时间戳与计数在安全整数内，转换是安全的）。
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

interface QueryResultRows {
  readonly rows: unknown[];
}

// PostgreSQL 连接池：返回池上的执行面（游标 + int8 → BigInt）。
export function openPostgres(config: Extract<OpenConfig, { dialect: "postgres" }>): Executor {
  const pool = new Pool({ connectionString: config.connectionString, types: bigintTypes() });
  // 空闲连接上的错误（服务端被重启、库被强制断开）不能变成未捕获异常：下一次查询会拿到
  // `connection` 分类的 `DbError`，那才是调用方能处理的面。
  pool.on("error", () => undefined);
  // 写队列按库身份共享：同进程里指向同一个库（连接串 + schema）的实例共用一条队列。
  const enqueue = serialQueueFor(postgresLibraryKey(config.connectionString, config.schema));
  // 当前异步上下文所在的事务连接（嵌套时共享同一条连接，用保存点）。
  const current = new AsyncLocalStorage<PoolClient>();
  const lifecycle = createLifecycle();
  // backend pid 每连接查一次：取消要按 pid 让服务端停下这条语句。
  const backendPids = new WeakMap<PoolClient, number>();

  const pidOf = async (client: PoolClient): Promise<number> => {
    const known = backendPids.get(client);
    if (known !== undefined) return known;
    const result = (await client.query("SELECT pg_backend_pid() AS pid")) as QueryResultRows;
    const pid = Number((result.rows[0] as { pid?: unknown } | undefined)?.pid);
    backendPids.set(client, pid);
    return pid;
  };

  // 取消：`AbortSignal` 触发时从池里另取连接发 `pg_cancel_backend`（真取消，不是只在前后检查）。
  // 注册返回解绑函数；没有信号时是空操作，不额外往返。
  const armCancel = async (
    client: PoolClient,
    signal: AbortSignal | undefined,
  ): Promise<() => void> => {
    if (signal === undefined) return () => undefined;
    await pidOf(client);
    const onAbort = (): void => {
      void (async () => {
        try {
          const pid = backendPids.get(client);
          if (pid !== undefined) await pool.query("SELECT pg_cancel_backend($1)", [pid]);
        } catch {
          // 取消是尽力而为：语句前后的检查已经足够让调用方拿到 `canceled`。
        }
      })();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  };

  // 一条语句：注册取消 → 执行 → 解绑。
  const execute = async (
    client: PoolClient,
    text: string,
    params: readonly unknown[],
    options: ExecutorOptions | undefined,
  ): Promise<QueryResultRows> => {
    const detach = await armCancel(client, options?.signal);
    try {
      return (await client.query(text, params as never[])) as QueryResultRows;
    } finally {
      detach();
    }
  };

  // 真游标：按 200 行一批从连接读，调用方提前 break 时释放。
  // `onRelease` 只在池路径上传（事务连接由事务自己归还）；登记进生命周期，`close()` 时先关游标。
  const cursorRows = async function* (
    client: PoolClient,
    text: string,
    params: readonly unknown[],
    signal: AbortSignal | undefined,
    onRelease?: () => void,
  ): AsyncIterable<unknown> {
    // 先取 backend pid（`armCancel`）：游标一旦提交，这条连接上的查询要等游标读完才轮到，
    // pid 查询排在游标后面就永远等不到。
    let detach: () => void = () => undefined;
    detach = await armCancel(client, signal);
    const cursor = client.query(new Cursor(text, params as never[]));
    const unregister = lifecycle.register({
      close: () => cursor.close().catch(() => undefined),
      release: () => onRelease?.(),
    });
    try {
      for (;;) {
        // 批次之间检查取消：单条语句已被 `pg_cancel_backend` 打断，这里管「不再要下一批」。
        if (signal?.aborted === true) throw canceledError(signal.reason);
        let rows: unknown[];
        try {
          rows = (await cursor.read(200)) as unknown[];
        } catch (error) {
          // close() 关掉游标后 read 会拒绝：调用方拿到「库已关闭」，不是驱动裸错。
          if (lifecycle.closed) throw closedError("iterate");
          throw error;
        }
        if (rows.length === 0) return;
        for (const row of rows) yield row;
      }
    } finally {
      detach();
      unregister();
      await cursor.close().catch(() => undefined);
    }
  };

  const pooledIterate = async function* (
    text: string,
    params: readonly unknown[],
    signal: AbortSignal | undefined,
  ): AsyncIterable<unknown> {
    lifecycle.assertOpen("iterate");
    const client = await pool.connect();
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      client.release();
    };
    try {
      lifecycle.assertOpen("iterate");
      yield* cursorRows(client, text, params, signal, release);
    } finally {
      release();
    }
  };

  // 一条连接上的执行面（顶层事务与嵌套事务共用）。
  const scopeOf = (client: PoolClient): Executor => ({
    iterate: (text, params, options) => cursorRows(client, text, params, options?.signal),
    async write(text, params, options) {
      lifecycle.assertOpen("write");
      const result = await execute(client, text, params, options);
      return result.rows;
    },
    async run(text, params, options) {
      lifecycle.assertOpen("run");
      await execute(client, text, params, options);
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
    // 事务内的读必须走事务连接：池里另取一条连接读不到本事务未提交的写入，
    // 症状是「事务里刚 update 完再 select 回来还是旧值」（写路径用它做位点校验时就是误报）。
    iterate(text, params, options) {
      lifecycle.assertOpen("iterate");
      const client = current.getStore();
      return client === undefined
        ? pooledIterate(text, params, options?.signal)
        : cursorRows(client, text, params, options?.signal);
    },
    // 写通道与 `run` 共用队列：事务外带 `RETURNING` 的写不会和别的事务交错。
    write(text, params, options) {
      lifecycle.assertOpen("write");
      const client = current.getStore();
      if (client !== undefined) return scopeOf(client).write(text, params, options);
      return enqueue(async () => {
        lifecycle.assertOpen("write");
        const held = await pool.connect();
        try {
          return (await execute(held, text, params, options)).rows;
        } finally {
          held.release();
        }
      });
    },
    run(text, params, options) {
      lifecycle.assertOpen("run");
      const client = current.getStore();
      if (client !== undefined) return scopeOf(client).run(text, params, options);
      return enqueue(async () => {
        lifecycle.assertOpen("run");
        const held = await pool.connect();
        try {
          await execute(held, text, params, options);
        } finally {
          held.release();
        }
      });
    },
    transaction(fn) {
      lifecycle.assertOpen("transaction");
      const held = current.getStore();
      if (held !== undefined) return scopeOf(held).transaction(fn);
      return enqueue(async () => {
        lifecycle.assertOpen("transaction");
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
      // 幂等：第二次直接返回。
      if (lifecycle.closed) return;
      lifecycle.beginClose();
      // 先关在飞游标并交还它们的连接：`pool.end()` 会等所有 client 归还，不先关就永久 pending。
      await lifecycle.interruptAll();
      await enqueue(async () => undefined);
      await pool.end();
    },
  };
  return executor;
}
