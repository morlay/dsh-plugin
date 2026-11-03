import type { CatalogIndex } from "../catalog.ts";
import type { Catalog, TableDef } from "../defs.ts";
import type { Dialect, DialectName } from "../dialect.ts";
import type { Fragment } from "../fragment.ts";
import type { TableHandle } from "../table/handle.ts";

/**
 * 注入给业务的库句柄：只回答「哪张表」与「怎么读/写/开事务」；不暴露连接与 SQL。
 * `dialect` 只给迁移 / 日志这类基础层用，业务查询不需要它。
 * 连接生命周期由创建它的一方（装配层）管理，业务拿到的是这个接口。
 */
export interface Database<C extends Catalog = Catalog> {
  /** 迁移 / 日志用；业务不需要读它。 */
  readonly dialect: Dialect;
  /** 装配层注册的 catalog（按表名解析；没注册时只能传定义）。 */
  readonly catalog: CatalogIndex;
  /** 按表名取（catalog 里有定义时保留强类型）。 */
  table<K extends C[number]["name"] & string>(
    name: K,
  ): TableHandle<Extract<C[number], { name: K }>>;
  /** 直接传定义（catalog 未注册时）。 */
  table<T extends TableDef>(definition: T): TableHandle<T>;
  /** 主读路径：按行流式迭代（与 Golang 的 `iter.Seq2` 对齐，不一次性物化大结果）。 */
  iterate<T>(query: Fragment): AsyncIterable<T>;
  /** 便捷读：把迭代器收成数组（报表 / 迁移读取用）。 */
  read<T>(query: Fragment): Promise<T[]>;
  /** 写入并拿回行（`RETURNING`；没有 RETURNING 的语句返回空数组）。 */
  write<T>(query: Fragment): Promise<T[]>;
  run(query: Fragment): Promise<void>;
  transaction<T>(fn: (database: Database<C>) => Promise<T>): Promise<T>;
  /** 现有的表与视图名（迁移探测旧表、拒绝别人的库都要它）。 */
  objectNames(): Promise<string[]>;
  /** 回收空间与统计（SQLite `VACUUM` / PostgreSQL `VACUUM ANALYZE`）；不得在事务内调用。 */
  vacuum(): Promise<void>;
  /** 读 SQLite 的 `PRAGMA`（其它方言直接报不支持）。 */
  sqlitePragma(name: SqlitePragmaName): Promise<string | number | undefined>;
  /** 写 SQLite 的 `PRAGMA`（值只允许安全字面量，见 `assertPragmaValue`）。 */
  setSqlitePragma(name: SqlitePragmaName, value: string | number): Promise<void>;
  close(): Promise<void>;
}

/** 业务侧用得到的 SQLite PRAGMA（库身份与日志模式；其余不开口子）。 */
export type SqlitePragmaName = "user_version" | "application_id" | "journal_mode";

export type OpenConfig =
  | {
      dialect: "sqlite";
      path: string;
      journalMode?: "wal" | "delete" | "truncate" | "persist";
      busyTimeout?: number;
      /** SQLite 页缓存（KB，负数表示 KB 数；不传用 SQLite 默认）。 */
      cacheSizeKb?: number;
      /** mmap 窗口（字节；0 关闭）。 */
      mmapSize?: number;
      /** 是否在打开时立即设置 `journal_mode`（默认 true；需要先校验库再切的调用方传 false）。 */
      applyJournalMode?: boolean;
    }
  | {
      dialect: "postgres";
      connectionString: string;
      schema?: string;
      /** 事务隔离级别（session-rdb 的写路径要 `serializable`）。 */
      isolationLevel?: "read committed" | "repeatable read" | "serializable";
    };

/** 一条已执行语句的观测（日志 / 慢查询 / 耗时统计）。 */
export interface QueryEvent {
  readonly dialect: DialectName;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly durationMs: number;
  readonly error?: unknown;
}

/** 打开时可带 catalog 与查询观测钩子。 */
export type OpenConfigWithCatalog<C extends Catalog = Catalog> = OpenConfig & {
  catalog?: C;
  onQuery?: (event: QueryEvent) => void;
};

/** 一条连接（或一个已开启的事务连接）的执行面：两种方言只实现这四个原语。 */
export interface Executor {
  iterate(text: string, params: readonly unknown[]): AsyncIterable<unknown>;
  run(text: string, params: readonly unknown[]): Promise<void>;
  transaction<T>(fn: (executor: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
