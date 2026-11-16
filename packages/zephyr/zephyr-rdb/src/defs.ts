import type { TableHandle } from "./table/handle.ts";
import type { Database } from "./database/types.ts";
// 表定义就是数据库结构的唯一来源：DDL、启动迁移、类型化的表句柄都从它算出来，
// 所以再加一张表 / 一列时不需要另写迁移 SQL，也不需要在 sqlite 与 postgres 各写一遍。

// 列类型：只保留跨方言能一一映射的那几种（`json` 在 SQLite 存 TEXT、PostgreSQL 用 JSONB）。
export type ColumnTypeName = "serial" | "integer" | "bigint" | "text" | "boolean" | "json";

// 外键的删除动作（与 SQL 的 ON DELETE 同名）。
export type DeleteAction = "cascade" | "set null" | "restrict" | "no action";

// 一列的定义。
export interface ColumnDef {
  type: ColumnTypeName;
  notNull?: boolean;
  // 单列主键；复合主键写在表级的 `primaryKey` 上。
  primaryKey?: boolean;
  default?: string | number;
  unique?: boolean;
  // 受检 text：只允许这些取值（DDL 上是 CHECK 约束，写入时构造期校验，读回来是 string）。
  values?: readonly string[];
  references?: {
    table: string;
    column: string;
    onDelete?: DeleteAction;
  };
}

// 表级约束与索引。
export interface CheckDef {
  expression: string;
}

export interface UniqueDef {
  columns: string[];
}

export interface IndexDef {
  columns: string[];
  // 部分索引的条件（`CREATE INDEX … WHERE <where>`，两方言都支持）；给了它只索引满足条件的行。
  where?: string;
}

// 一张表的完整定义。
export interface TableDef {
  name: string;
  columns: Record<string, ColumnDef>;
  // 复合主键（按顺序）；单列主键用列上的 `primaryKey`。
  primaryKey?: readonly string[];
  checks?: Record<string, CheckDef>;
  uniques?: Record<string, UniqueDef>;
  indexes?: Record<string, IndexDef>;
}

// 一组表定义（一个库的结构）。
export type Catalog = readonly TableDef[];

// `defineTable` 的返回值：表定义 + 操作钩子（`users.table(database)` 直接拿句柄）。
export type Table<T extends TableDef> = T & {
  table(database: Database): TableHandle<T>;
};

// 声明一张表（形状原样保留，另挂一个取句柄的钩子）。
export function defineTable<const T extends TableDef>(def: T): Table<T> {
  if (!/^[a-z][a-z0-9_]*$/u.test(def.name)) {
    throw new Error(`zephyr-rdb: table name '${def.name}' must match [a-z][a-z0-9_]*`);
  }
  const names = Object.keys(def.columns);
  if (names.length === 0) throw new Error(`zephyr-rdb: table '${def.name}' declares no columns`);
  for (const name of names) {
    if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
      throw new Error(
        `zephyr-rdb: table '${def.name}' column '${name}' must match [a-z][a-z0-9_]*`,
      );
    }
    const column = def.columns[name]!;
    if (column.values !== undefined && column.type !== "text") {
      throw new Error(
        `zephyr-rdb: column '${def.name}.${name}' declares values on a ${column.type} column; only text can be enumerated`,
      );
    }
    if (column.values !== undefined && column.values.length === 0) {
      throw new Error(`zephyr-rdb: column '${def.name}.${name}' declares an empty values list`);
    }
  }
  // 定义即操作钩子：`users.table(db)` 等价于 `db.table(users)`，业务侧不需要记两套写法。
  return {
    ...def,
    table: (database: Database) => database.table(def) as TableHandle<T>,
  } as Table<T>;
}

// 声明一组表。
export function defineCatalog<const T extends readonly TableDef[]>(tables: T): T {
  for (const table of tables) defineTable(table);
  return tables;
}
