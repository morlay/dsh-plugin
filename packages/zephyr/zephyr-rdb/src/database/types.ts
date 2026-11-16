import type { CatalogIndex } from "../catalog.ts";
import type { Catalog, TableDef } from "../defs.ts";
import type { Dialect, DialectName } from "../dialect.ts";
import type { Fragment } from "../fragment.ts";
import type { TableHandle } from "../table/handle.ts";
import type { LibraryIdentity, StoredIdentity } from "./identity.ts";

// 注入给业务的库句柄：只回答「哪张表」与「怎么读/写/开事务」；不暴露连接与 SQL。
// `dialect` 只给迁移 / 日志这类基础层用，业务查询不需要它。
// 连接生命周期由创建它的一方（装配层）管理，业务拿到的是这个接口。
export interface Database<C extends Catalog = Catalog> {
  // 迁移 / 日志用；业务不需要读它。
  readonly dialect: Dialect;
  // 装配层注册的 catalog（按表名解析；没注册时只能传定义）。
  readonly catalog: CatalogIndex;
  // 生成 SQL 的目标 schema：PostgreSQL 恒有值（配置缺省 public），SQLite 是 undefined。
  // DDL、DML、迁移账本与结构探测都从这里取，不各自猜。
  readonly schema: string | undefined;
  // 按表名取（catalog 里有定义时保留强类型）。
  table<K extends C[number]["name"] & string>(
    name: K,
  ): TableHandle<Extract<C[number], { name: K }>>;
  // 直接传定义（catalog 未注册时）。
  table<T extends TableDef>(definition: T): TableHandle<T>;
  // 主读路径：按行流式迭代（与 Golang 的 `iter.Seq2` 对齐，不一次性物化大结果）。
  iterate<T>(query: Fragment, options?: QueryOptions): AsyncIterable<T>;
  // 便捷读：把迭代器收成数组（报表 / 迁移读取用）。
  read<T>(query: Fragment, options?: QueryOptions): Promise<T[]>;
  // 写通道：与 `run` 共用写队列（事务外串行、事务内走事务连接），并拿回 `RETURNING` 的行。
  write<T>(query: Fragment, options?: QueryOptions): Promise<T[]>;
  run(query: Fragment, options?: QueryOptions): Promise<void>;
  transaction<T>(fn: (database: Database<C>) => Promise<T>, options?: QueryOptions): Promise<T>;
  // 查询计划（两方言文本不同，统一成「计划行数组」；值是方言原文）。
  explain(query: Fragment): Promise<string[]>;
  // 库身份（域层声明「我是谁、版本多少」）：打开时校验，不符即拒绝。
  readIdentity(): Promise<StoredIdentity | undefined>;
  writeIdentity(identity: LibraryIdentity): Promise<void>;
  // 现有的表与视图名（迁移探测旧表、拒绝别人的库都要它）。
  objectNames(): Promise<string[]>;
  // 回收空间与统计（SQLite `VACUUM` / PostgreSQL `VACUUM ANALYZE`）；不得在事务内调用。
  vacuum(): Promise<void>;
  // 读 SQLite 的 `PRAGMA`（其它方言直接报不支持）。
  sqlitePragma(name: SqlitePragmaName): Promise<string | number | undefined>;
  // 写 SQLite 的 `PRAGMA`（值只允许安全字面量，见 `assertPragmaValue`）。
  setSqlitePragma(name: SqlitePragmaName, value: string | number): Promise<void>;
  close(): Promise<void>;
}

// 业务侧用得到的 SQLite PRAGMA（库身份与日志模式；其余不开口子）。
export type SqlitePragmaName = "user_version" | "application_id" | "journal_mode";

export type OpenConfig =
  | {
      dialect: "sqlite";
      path: string;
      journalMode?: "wal" | "delete" | "truncate" | "persist";
      busyTimeout?: number;
      // SQLite 页缓存（KB，负数表示 KB 数；不传用 SQLite 默认）。
      cacheSizeKb?: number;
      // mmap 窗口（字节；0 关闭）。
      mmapSize?: number;
      // 是否在打开时立即设置 `journal_mode`（默认 true；需要先校验库再切的调用方传 false）。
      applyJournalMode?: boolean;
    }
  | {
      dialect: "postgres";
      connectionString: string;
      schema?: string;
      // 事务隔离级别（session-rdb 的写路径要 `serializable`）。
      isolationLevel?: "read committed" | "repeatable read" | "serializable";
    };

// 一条已执行语句的观测（日志 / 慢查询 / 耗时统计）。
export interface QueryEvent {
  readonly dialect: DialectName;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly durationMs: number;
  // 流式读实际消费的行数（非流式路径省略）。
  readonly rows?: number;
  readonly error?: unknown;
}

// 打开时可带 catalog、查询观测钩子与库身份（给 identity 时打开即校验：不符就拒绝）。
export type OpenConfigWithCatalog<C extends Catalog = Catalog> = OpenConfig & {
  catalog?: C;
  onQuery?: (event: QueryEvent) => void;
  identity?: LibraryIdentity;
};

// 调用方给一条语句的可选项。
export interface QueryOptions {
  // 取消信号：语句前后与流式读的批次之间检查；PostgreSQL 侧会发起后端取消。
  readonly signal?: AbortSignal;
}

// 执行一条语句时可带的提示（由片段渲染时汇总出来，不是调用方手写；`signal` 是调用方给的）。
export interface ExecutorOptions extends QueryOptions {
  // 这条语句要按 BigInt 读整数列（SQLite 的 `setReadBigInts` 是语句级开关）。
  readonly readBigInts?: boolean;
}

// 一条连接（或一个已开启的事务连接）的执行面：两种方言只实现这四个原语。
//
// `iterate` 是读，`write` 是写并拿回行，`run` 是不拿回行的写：`write` 与 `run` 共用同一条
// 串行队列（事务外），所以带 `RETURNING` 的写不会插进别的上下文未提交的事务里。
export interface Executor {
  iterate(
    text: string,
    params: readonly unknown[],
    options?: ExecutorOptions,
  ): AsyncIterable<unknown>;
  // 写入并物化 `RETURNING` 的行：行数由写入行数决定，不会是大结果集。
  write(text: string, params: readonly unknown[], options?: ExecutorOptions): Promise<unknown[]>;
  run(text: string, params: readonly unknown[], options?: ExecutorOptions): Promise<void>;
  transaction<T>(fn: (executor: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
