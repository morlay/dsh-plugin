import type { ColumnDef, TableDef } from "./defs.ts";
import { unsupportedError } from "./error.ts";

// 支持的方言。
export type DialectName = "sqlite" | "postgres";

// 方言之间的能力差别（能力矩阵的可执行版本）。`supports` 是唯一判据，
// 缺能力时调用方拿到 `DbError("unsupported")`，不是静默降级。
export type DialectCapability =
  // 显式 schema 限定（`"schema"."table"`）。
  | "schema"
  // 行锁：`FOR UPDATE [NOWAIT | SKIP LOCKED]`。
  | "row-lock"
  // 会话级 advisory lock（迁移并发锁）。
  | "advisory-lock"
  // JSON 文本 / 整数提取。
  | "json"
  // `EXPLAIN` 查询计划。
  | "explain"
  // 部分索引（`CREATE INDEX … WHERE …`）。
  | "partial-index"
  // 嵌套事务的保存点。
  | "savepoint"
  // `VACUUM ANALYZE`（SQLite 只有 `VACUUM`）。
  | "vacuum-analyze";

// 一列在库里的样子（迁移比「同名不同形」用）：类型 / 可空 / 默认值都是**库里的原文**，
// 归一化与比较在 `migrate.ts`（方言只负责如实读出来）。
export interface ColumnShape {
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | undefined;
}

// 一个索引在库里的样子：列按索引里的顺序，`unique` 是唯一索引。
export interface IndexShape {
  readonly columns: readonly string[];
  readonly unique: boolean;
}

// 现有结构的一块：名字集合是「有没有」，细节是「同不同形」。
// 细节读不到（宿主自造 shape）时只报缺失，不报漂移——宁可少报，不误报。
export interface TableShape {
  readonly columns: ReadonlySet<string>;
  readonly indexes: ReadonlySet<string>;
  readonly columnShapes?: ReadonlyMap<string, ColumnShape>;
  readonly indexShapes?: ReadonlyMap<string, IndexShape>;
}

// 一个方言：类型映射、标识符、DDL 片段，以及读现有结构的查询。
export interface Dialect {
  readonly name: DialectName;
  // 标识符引用（表名 / 列名 / 索引名）。
  quote(identifier: string): string;
  // 带 schema 的表名（sqlite 忽略 schema）。
  tableName(table: string, schema?: string): string;
  // 带 schema 的索引名（sqlite 忽略 schema）：`DROP INDEX` 也要按它限定。
  indexName(index: string, schema?: string): string;
  // 列类型（含自增主键的特殊写法）。
  columnType(column: ColumnDef): string;
  // 这个方言有没有这项能力（缺能力时调用方抛 `unsupported`，见 `assertSupported`）。
  supports(capability: DialectCapability): boolean;
  // 读现有表的列与索引；表不存在返回 undefined。
  readShape(database: ShapeReader, table: string, schema?: string): Promise<TableShape | undefined>;
}

// 读结构所需的最小执行面（`database/wrap.ts` 的 `shapeReader` 把 `Database` 包成它）。
export interface ShapeReader {
  query<T>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

const SQLITE_KEYWORDS = /^[a-z][a-z0-9_]*$/u;

function assertIdentifier(kind: string, name: string): void {
  if (!SQLITE_KEYWORDS.test(name)) throw new Error(`zephyr-rdb: invalid ${kind} '${name}'`);
}

// 两种方言各自支持的能力：这张表就是能力矩阵的代码事实（文档与用例都以它为准）。
const SQLITE_CAPABILITIES: ReadonlySet<DialectCapability> = new Set<DialectCapability>([
  "json",
  "explain",
  "partial-index",
  "savepoint",
]);

const POSTGRES_CAPABILITIES: ReadonlySet<DialectCapability> = new Set<DialectCapability>([
  "schema",
  "row-lock",
  "advisory-lock",
  "json",
  "explain",
  "partial-index",
  "savepoint",
  "vacuum-analyze",
]);

// 缺能力就抛 `unsupported`：静默丢弃会让同一份业务代码换库后悄悄少做事。
export function assertSupported(
  dialect: Dialect,
  capability: DialectCapability,
  operation: string,
): void {
  if (dialect.supports(capability)) return;
  throw unsupportedError(dialect.name, `${capability} (${operation})`);
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
    indexName(index) {
      assertIdentifier("index", index);
      return `"${index}"`;
    },
    columnType(column) {
      // `serial` 在 SQLite 就是「整型主键 + 自增」；其它类型都能直接映射。
      if (column.type === "serial") return "INTEGER";
      if (column.type === "boolean") return "INTEGER";
      if (column.type === "bigint" || column.type === "integer") return "INTEGER";
      // JSON 在 SQLite 没有独立类型：存 TEXT，靠 JSON1 函数读写。
      return "TEXT";
    },
    supports(capability) {
      return SQLITE_CAPABILITIES.has(capability);
    },
    async readShape(database, table) {
      const exists = await database.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      if (exists.length === 0) return undefined;
      const columns = await database.query<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>(`PRAGMA table_info("${table}")`);
      const indexes = await database.query<{ name: string; unique: number }>(
        `PRAGMA index_list("${table}")`,
      );
      const columnShapes = new Map<string, ColumnShape>();
      for (const row of columns) {
        columnShapes.set(row.name, {
          type: row.type,
          notNull: row.notnull === 1,
          defaultValue: row.dflt_value ?? undefined,
        });
      }
      const indexShapes = new Map<string, IndexShape>();
      for (const index of indexes) {
        // `PRAGMA index_info` 对表达式索引给 name = null（不参与比较）。
        const info = await database.query<{ name: string | null }>(
          `PRAGMA index_info("${index.name}")`,
        );
        indexShapes.set(index.name, {
          columns: info.flatMap((row) => (row.name === null ? [] : [row.name])),
          unique: index.unique === 1,
        });
      }
      return {
        columns: new Set(columns.map((row) => row.name)),
        indexes: new Set(indexes.map((row) => row.name)),
        columnShapes,
        indexShapes,
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
    indexName(index, schema = "public") {
      assertIdentifier("schema", schema);
      assertIdentifier("index", index);
      return `"${schema}"."${index}"`;
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
        case "json":
          return "JSONB";
        default:
          return "TEXT";
      }
    },
    supports(capability) {
      return POSTGRES_CAPABILITIES.has(capability);
    },
    async readShape(database, table, schema = "public") {
      const columns = await database.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        "SELECT column_name, data_type, is_nullable, column_default " +
          "FROM information_schema.columns WHERE table_schema = ? AND table_name = ?",
        [schema, table],
      );
      if (columns.length === 0) return undefined;
      // 索引的列按索引里的顺序取（`indkey` 是 int2vector，下标从 0 开始）。
      const indexes = await database.query<{
        index_name: string;
        is_unique: boolean;
        column_name: string;
        position: number;
      }>(
        "SELECT i.relname AS index_name, ix.indisunique AS is_unique, " +
          "a.attname AS column_name, s.pos AS position " +
          "FROM pg_index ix " +
          "JOIN pg_class i ON i.oid = ix.indexrelid " +
          "JOIN pg_class t ON t.oid = ix.indrelid " +
          "JOIN pg_namespace n ON n.oid = t.relnamespace " +
          "CROSS JOIN LATERAL generate_subscripts(ix.indkey, 1) AS s(pos) " +
          "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[s.pos] " +
          "WHERE n.nspname = ? AND t.relname = ? ORDER BY i.relname, s.pos",
        [schema, table],
      );
      const columnShapes = new Map<string, ColumnShape>();
      for (const row of columns) {
        columnShapes.set(row.column_name, {
          type: row.data_type,
          notNull: row.is_nullable === "NO",
          defaultValue: row.column_default ?? undefined,
        });
      }
      const indexColumns = new Map<string, { columns: string[]; unique: boolean }>();
      for (const row of indexes) {
        const shape = indexColumns.get(row.index_name);
        if (shape === undefined) {
          indexColumns.set(row.index_name, {
            columns: [row.column_name],
            unique: row.is_unique === true,
          });
        } else {
          shape.columns.push(row.column_name);
        }
      }
      const indexShapes = new Map<string, IndexShape>();
      for (const [name, shape] of indexColumns) indexShapes.set(name, shape);
      return {
        columns: new Set(columns.map((row) => row.column_name)),
        indexes: new Set(indexShapes.keys()),
        columnShapes,
        indexShapes,
      };
    },
  };
}

// 一列的定义 SQL（`"name" TEXT NOT NULL ...`）；外键引用跟着表名一起落在同一 schema。
export function columnSql(
  dialect: Dialect,
  name: string,
  column: ColumnDef,
  schema?: string,
): string {
  assertIdentifier("column", name);
  const parts = [dialect.quote(name), dialect.columnType(column)];
  if (column.type === "serial" && dialect.name === "sqlite")
    parts.push("PRIMARY KEY AUTOINCREMENT");
  else if (column.primaryKey === true) parts.push("PRIMARY KEY");
  if (column.notNull === true) parts.push("NOT NULL");
  if (column.unique === true) parts.push("UNIQUE");
  // 枚举列：`CHECK ("col" IN ('a', 'b'))`（值只来自定义，按字面量转义）。
  if (column.values !== undefined && column.values.length > 0) {
    parts.push(
      `CHECK (${dialect.quote(name)} IN (${column.values
        .map((value) => literal(dialect, value, "text"))
        .join(", ")}))`,
    );
  }
  if (column.default !== undefined)
    parts.push(`DEFAULT ${literal(dialect, column.default, column.type)}`);
  if (column.references !== undefined) {
    const { table, column: referenced, onDelete } = column.references;
    assertIdentifier("table", table);
    assertIdentifier("column", referenced);
    parts.push(
      `REFERENCES ${dialect.tableName(table, schema)}(${dialect.quote(referenced)})` +
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

// 建表语句（IF NOT EXISTS；列与表级约束都由定义算出来）。
export function createTableSql(dialect: Dialect, table: TableDef, schema?: string): string {
  const parts = Object.entries(table.columns).map(([name, column]) =>
    columnSql(dialect, name, column, schema),
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

// 索引语句（`unique` 时是唯一索引；`index.where` 给了就是部分索引）。
export function createIndexSql(
  dialect: Dialect,
  table: TableDef,
  name: string,
  index: { readonly columns: readonly string[]; readonly where?: string | undefined },
  unique = false,
  schema?: string,
): string {
  assertIdentifier("index", name);
  const columns = index.columns.map((column) => dialect.quote(column)).join(", ");
  const where = index.where === undefined ? "" : ` WHERE ${index.where}`;
  return (
    `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${dialect.quote(name)} ` +
    `ON ${dialect.tableName(table.name, schema)} (${columns})${where}`
  );
}

// 删列（只在显式允许破坏性变更时用）。
export function dropColumnSql(
  dialect: Dialect,
  table: string,
  name: string,
  schema?: string,
): string {
  assertIdentifier("column", name);
  return `ALTER TABLE ${dialect.tableName(table, schema)} DROP COLUMN ${dialect.quote(name)}`;
}

// 删索引（只在显式允许破坏性变更时用）。
//
// `DROP INDEX` 按 search_path 解析，所以要带 schema；索引名走 `indexName` 而不是 `tableName`，
// 报错时说的才是「invalid index」。
export function dropIndexSql(dialect: Dialect, name: string, schema?: string): string {
  return `DROP INDEX IF EXISTS ${dialect.indexName(name, schema)}`;
}

// 加列语句（启动迁移只做「缺列则补」，不改类型、不删列）。
export function addColumnSql(
  dialect: Dialect,
  table: string,
  name: string,
  column: ColumnDef,
  schema?: string,
): string {
  return `ALTER TABLE ${dialect.tableName(table, schema)} ADD COLUMN ${columnSql(dialect, name, column, schema)}`;
}
