import type { ColumnDef, TableDef } from "./defs.ts";

/** 支持的方言。 */
export type DialectName = "sqlite" | "postgres";

/** 现有结构的一小块：迁移只关心「有没有这张表 / 这一列 / 这个索引」。 */
export interface TableShape {
  columns: ReadonlySet<string>;
  indexes: ReadonlySet<string>;
}

/** 一个方言：类型映射、标识符、DDL 片段，以及读现有结构的查询。 */
export interface Dialect {
  readonly name: DialectName;
  /** 标识符引用（表名 / 列名 / 索引名）。 */
  quote(identifier: string): string;
  /** 带 schema 的表名（sqlite 忽略 schema）。 */
  tableName(table: string, schema?: string): string;
  /** 列类型（含自增主键的特殊写法）。 */
  columnType(column: ColumnDef): string;
  /** 读现有表的列与索引；表不存在返回 undefined。 */
  readShape(database: ShapeReader, table: string, schema?: string): Promise<TableShape | undefined>;
}

/** 读结构所需的最小执行面（由 `openDatabase` 提供）。 */
export interface ShapeReader {
  query<T>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

const SQLITE_KEYWORDS = /^[a-z][a-z0-9_]*$/u;

function assertIdentifier(kind: string, name: string): void {
  if (!SQLITE_KEYWORDS.test(name)) throw new Error(`rdbkit: invalid ${kind} '${name}'`);
}

export function createDialect(name: DialectName): Dialect {
  return name === "sqlite" ? sqliteDialect() : postgresDialect();
}

function sqliteDialect(): Dialect {
  return {
    name: "sqlite",
    quote(identifier) {
      assertIdentifier("identifier", identifier);
      return `"${identifier}"`;
    },
    tableName(table) {
      assertIdentifier("table", table);
      return `"${table}"`;
    },
    columnType(column) {
      // `serial` 在 SQLite 就是「整型主键 + 自增」；其它类型都能直接映射。
      if (column.type === "serial") return "INTEGER";
      if (column.type === "boolean") return "INTEGER";
      if (column.type === "bigint" || column.type === "integer") return "INTEGER";
      return "TEXT";
    },
    async readShape(database, table) {
      const exists = await database.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      if (exists.length === 0) return undefined;
      const columns = await database.query<{ name: string }>(`PRAGMA table_info("${table}")`);
      const indexes = await database.query<{ name: string }>(`PRAGMA index_list("${table}")`);
      return {
        columns: new Set(columns.map((row) => row.name)),
        indexes: new Set(indexes.map((row) => row.name)),
      };
    },
  };
}

function postgresDialect(): Dialect {
  return {
    name: "postgres",
    quote(identifier) {
      assertIdentifier("identifier", identifier);
      return `"${identifier}"`;
    },
    tableName(table, schema = "public") {
      assertIdentifier("schema", schema);
      assertIdentifier("table", table);
      return `"${schema}"."${table}"`;
    },
    columnType(column) {
      switch (column.type) {
        case "serial":
          return "SERIAL";
        case "boolean":
          return "BOOLEAN";
        case "bigint":
          return "BIGINT";
        case "integer":
          return "INTEGER";
        default:
          return "TEXT";
      }
    },
    async readShape(database, table, schema = "public") {
      const columns = await database.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?",
        [schema, table],
      );
      if (columns.length === 0) return undefined;
      const indexes = await database.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE schemaname = ? AND tablename = ?",
        [schema, table],
      );
      return {
        columns: new Set(columns.map((row) => row.column_name)),
        indexes: new Set(indexes.map((row) => row.indexname)),
      };
    },
  };
}

/** 一列的定义 SQL（`"name" TEXT NOT NULL ...`）。 */
export function columnSql(dialect: Dialect, name: string, column: ColumnDef): string {
  assertIdentifier("column", name);
  const parts = [dialect.quote(name), dialect.columnType(column)];
  if (column.type === "serial" && dialect.name === "sqlite")
    parts.push("PRIMARY KEY AUTOINCREMENT");
  else if (column.primaryKey === true) parts.push("PRIMARY KEY");
  if (column.notNull === true) parts.push("NOT NULL");
  if (column.unique === true) parts.push("UNIQUE");
  if (column.default !== undefined)
    parts.push(`DEFAULT ${literal(dialect, column.default, column.type)}`);
  if (column.references !== undefined) {
    const { table, column: referenced, onDelete } = column.references;
    assertIdentifier("table", table);
    assertIdentifier("column", referenced);
    parts.push(
      `REFERENCES ${dialect.tableName(table)}(${dialect.quote(referenced)})` +
        (onDelete === undefined ? "" : ` ON DELETE ${onDelete.toUpperCase()}`),
    );
  }
  return parts.join(" ");
}

function literal(dialect: Dialect, value: string | number, type: ColumnDef["type"]): string {
  if (type === "boolean") {
    if (typeof value === "number") {
      return dialect.name === "postgres" ? (value === 0 ? "FALSE" : "TRUE") : String(value);
    }
    return dialect.name === "postgres"
      ? value.toUpperCase()
      : /^(true|1)$/iu.test(value)
        ? "1"
        : "0";
  }
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

/** 建表语句（IF NOT EXISTS；列与表级约束都由定义算出来）。 */
export function createTableSql(dialect: Dialect, table: TableDef, schema?: string): string {
  const parts = Object.entries(table.columns).map(([name, column]) =>
    columnSql(dialect, name, column),
  );
  const primaryKey =
    table.primaryKey === undefined
      ? undefined
      : table.primaryKey.map((name) => dialect.quote(name)).join(", ");
  if (primaryKey !== undefined) parts.push(`PRIMARY KEY (${primaryKey})`);
  for (const [name, check] of Object.entries(table.checks ?? {})) {
    assertIdentifier("constraint", name);
    parts.push(`CONSTRAINT ${dialect.quote(name)} CHECK (${check.expression})`);
  }
  for (const [name, unique] of Object.entries(table.uniques ?? {})) {
    assertIdentifier("constraint", name);
    parts.push(
      `CONSTRAINT ${dialect.quote(name)} UNIQUE (${unique.columns
        .map((column) => dialect.quote(column))
        .join(", ")})`,
    );
  }
  return (
    `CREATE TABLE IF NOT EXISTS ${dialect.tableName(table.name, schema)} (\n  ` +
    `${parts.join(",\n  ")}\n)`
  );
}

/** 索引语句（`unique` 时是唯一索引）。 */
export function createIndexSql(
  dialect: Dialect,
  table: TableDef,
  name: string,
  columns: readonly string[],
  unique = false,
): string {
  assertIdentifier("index", name);
  return (
    `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${dialect.quote(name)} ` +
    `ON ${dialect.tableName(table.name)} (${columns.map((column) => dialect.quote(column)).join(", ")})`
  );
}

/** 删列（只在显式允许破坏性变更时用）。 */
export function dropColumnSql(dialect: Dialect, table: string, name: string): string {
  assertIdentifier("column", name);
  return `ALTER TABLE ${dialect.tableName(table)} DROP COLUMN ${dialect.quote(name)}`;
}

/** 删索引（只在显式允许破坏性变更时用）。 */
export function dropIndexSql(dialect: Dialect, name: string): string {
  assertIdentifier("index", name);
  return `DROP INDEX IF EXISTS ${dialect.quote(name)}`;
}

/** 加列语句（启动迁移只做「缺列则补」，不改类型、不删列）。 */
export function addColumnSql(
  dialect: Dialect,
  table: string,
  name: string,
  column: ColumnDef,
): string {
  return `ALTER TABLE ${dialect.tableName(table)} ADD COLUMN ${columnSql(dialect, name, column)}`;
}
