import {
  addColumnSql,
  createIndexSql,
  createTableSql,
  dropColumnSql,
  dropIndexSql,
  type Dialect,
  type IndexShape,
  type TableShape,
} from "./dialect.ts";
import type { Catalog, ColumnDef, ColumnTypeName, TableDef } from "./defs.ts";
import { tableNames } from "./database/capabilities.ts";
import type { Database } from "./database/types.ts";
import { shapeReader } from "./database/wrap.ts";
import { fragment } from "./fragment.ts";

// 迁移账本的表名（定义在 `migration.ts`，由 `runMigrations` 自管）：它不出现在业务 catalog 里，
// 但也不算 orphan——账本的增删不归结构对齐管。
export const SCHEMA_MIGRATIONS_TABLE = "t_schema_migrations";

// 一条结构变更（按顺序执行）。
export interface SchemaChange {
  readonly table: string;
  readonly kind: "create-table" | "add-column" | "create-index" | "drop-index" | "drop-column";
  readonly statement: string;
}

// 漂移的两类：库里已有的表「同名不同形」，以及库里有、catalog 没有的表（orphan）。
// `fix` 说这条能不能自动修——`auto` 会进 `changes`（重建索引这类可逆操作），`manual` 只报告
//（改列类型 / 可空 / 默认值、删 orphan 表都要人决定）。
export type SchemaDriftKind =
  | "column-type"
  | "column-nullability"
  | "column-default"
  | "index-columns"
  | "index-uniqueness"
  | "missing-unique"
  // 库里有、catalog 没有的表：只报告，不生成任何 DDL（尤其不删表）。
  | "orphan";

export interface SchemaDrift {
  readonly table: string;
  readonly kind: SchemaDriftKind;
  readonly fix: "auto" | "manual";
  // 给调用方可读的现状（例如 `t_items.f_count: defined integer, database has text`）。
  readonly detail: string;
}

// 一次结构对齐的计划：`changes` 是要执行的，`drift` 是要报给人看的。
export interface SchemaPlan {
  readonly changes: readonly SchemaChange[];
  readonly drift: readonly SchemaDrift[];
}

// `ensureSchema` 的结果：执行了哪些语句 + 报告了哪些漂移。
export interface SchemaResult {
  readonly statements: readonly string[];
  readonly drift: readonly SchemaDrift[];
}

export interface EnsureSchemaOptions {
  // PostgreSQL 的 schema（省略即 `database.schema`，再缺省是 `public`）；SQLite 忽略。
  schema?: string;
  // 允许删掉定义里已经不存在、且确实多出来的列（默认关闭：升级不丢数据）。
  allowDestructive?: boolean;
  // 需要看到实际执行的语句时（排查 / 测试）。
  onStatement?: (statement: string) => void;
}

// 库里的类型文本 → 可比较的类型名（PostgreSQL 的 `character varying`、`int8` 这类别名都归到一处）。
function typeKey(raw: string): string {
  const text = raw.trim().toLowerCase().replace(/\s+/gu, " ");
  if (text === "bigint" || text === "int8") return "bigint";
  if (text === "boolean" || text === "bool") return "boolean";
  if (text.startsWith("character varying") || text === "varchar" || text === "text") return "text";
  if (["integer", "int", "int4", "serial", "serial4"].includes(text)) return "integer";
  return text;
}

// 库里的默认值文本 → 可比较的规范值（PostgreSQL 的 `'x'::text` 与 SQLite 的 `'x'` 归一）。
function defaultKey(raw: string | undefined, type: ColumnTypeName): string | undefined {
  if (raw === undefined) return undefined;
  let text = raw.trim();
  if (text === "" || text.toUpperCase() === "NULL") return undefined;
  text = text.replace(/::[a-z_ ]+(?:\(\d+\))?$/iu, "").trim();
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) text = text.slice(1, -1);
  if (type === "boolean") {
    const lower = text.toLowerCase();
    if (lower === "true" || lower === "1") return "true";
    if (lower === "false" || lower === "0") return "false";
  }
  return text;
}

// 表定义里的默认值 → 同一个规范值。
function definedDefault(column: ColumnDef): string | undefined {
  if (column.default === undefined) return undefined;
  const text = String(column.default).trim();
  if (column.type === "boolean") {
    const lower = text.toLowerCase();
    return lower === "true" || lower === "1" ? "true" : "false";
  }
  return text;
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

// 一列的同名不同形：类型 / 可空 / 默认值各报一条，都是 `manual`（改它们要人决定，SQLite 也改不了列）。
function columnDrifts(
  dialect: Dialect,
  table: TableDef,
  name: string,
  column: ColumnDef,
  shape: TableShape,
): SchemaDrift[] {
  const detail = shape.columnShapes?.get(name);
  if (detail === undefined) return [];
  const drifts: SchemaDrift[] = [];
  const expectedType = typeKey(dialect.columnType(column));
  const actualType = typeKey(detail.type);
  if (expectedType !== actualType) {
    drifts.push({
      table: table.name,
      kind: "column-type",
      fix: "manual",
      detail: `${table.name}.${name}: defined ${expectedType}, database has ${actualType}`,
    });
  }
  // 主键列的可空两方言读法不一致（SQLite 的 PRAGMA 说主键列可为空，PostgreSQL 说不可空）；
  // 唯一性由索引判定覆盖，这里跳过，避免跨方言误报。
  const primary = column.primaryKey === true || (table.primaryKey ?? []).includes(name);
  const expectedNotNull = column.notNull === true;
  if (!primary && expectedNotNull !== detail.notNull) {
    drifts.push({
      table: table.name,
      kind: "column-nullability",
      fix: "manual",
      detail: `${table.name}.${name}: defined ${column.notNull === true ? "NOT NULL" : "nullable"}, database has ${detail.notNull ? "NOT NULL" : "NULL"}`,
    });
  }
  // 自增列（serial）的默认值由驱动生成（`nextval` / AUTOINCREMENT），不比较。
  if (column.type !== "serial") {
    const expected = definedDefault(column);
    const actual = defaultKey(detail.defaultValue, column.type);
    if (expected !== actual) {
      drifts.push({
        table: table.name,
        kind: "column-default",
        fix: "manual",
        detail: `${table.name}.${name}: defined default ${expected ?? "none"}, database has ${actual ?? "none"}`,
      });
    }
  }
  return drifts;
}

function indexDrift(
  table: TableDef,
  name: string,
  expected: readonly string[],
  unique: boolean,
  actual: IndexShape,
): SchemaDrift | undefined {
  if (!sameColumns(actual.columns, expected)) {
    return {
      table: table.name,
      kind: "index-columns",
      fix: "auto",
      detail: `${table.name}.${name}: defined columns (${expected.join(", ")}), database has (${actual.columns.join(", ")})`,
    };
  }
  if (actual.unique !== unique) {
    return {
      table: table.name,
      kind: "index-uniqueness",
      fix: "auto",
      detail: `${table.name}.${name}: defined ${unique ? "UNIQUE" : "non-unique"}, database index is ${actual.unique ? "unique" : "non-unique"}`,
    };
  }
  return undefined;
}

// 结构差异（纯函数）：缺表建表、缺列补列、缺索引补索引；「同名不同形」与 orphan 表进 drift。
//
// 默认只做「增」（缺表建表、缺列补列、缺索引补索引），不改类型、不删索引；删多出来的列只由
// `allowDestructive: true` 显式打开（旧库升级默认不丢数据）。orphan 表永远只报告：删表不在
// 这里做，也不受 `allowDestructive` 影响。
//
// `tables` 是库里现有的表名（见 `ensureSchema` 的探测）：省略时不知道库里有什么，就不报 orphan。
export function planSchema(
  dialect: Dialect,
  catalog: Catalog,
  shapes: ReadonlyMap<string, TableShape | undefined>,
  options: { schema?: string; allowDestructive?: boolean; tables?: readonly string[] } = {},
): SchemaPlan {
  const changes: SchemaChange[] = [];
  const drift: SchemaDrift[] = [];
  const add = (change: SchemaChange): void => {
    changes.push(change);
  };
  for (const table of catalog) {
    const shape = shapes.get(table.name);
    if (shape === undefined) {
      add({
        table: table.name,
        kind: "create-table",
        statement: createTableSql(dialect, table, options.schema),
      });
    } else {
      for (const [name, column] of Object.entries(table.columns)) {
        if (!shape.columns.has(name)) {
          add({
            table: table.name,
            kind: "add-column",
            statement: addColumnSql(
              dialect,
              table.name,
              name,
              assertAddable(table.name, name, column),
              options.schema,
            ),
          });
          continue;
        }
        drift.push(...columnDrifts(dialect, table, name, column, shape));
      }
      if (options.allowDestructive === true) {
        for (const name of shape.columns) {
          if (table.columns[name] !== undefined) continue;
          add({
            table: table.name,
            kind: "drop-column",
            statement: dropColumnSql(dialect, table.name, name, options.schema),
          });
        }
      }
    }
    for (const [name, index] of Object.entries(table.indexes ?? {})) {
      if (shape === undefined || !shape.indexes.has(name)) {
        add({
          table: table.name,
          kind: "create-index",
          statement: createIndexSql(dialect, table, name, index, false, options.schema),
        });
        continue;
      }
      const actual = shape.indexShapes?.get(name);
      if (actual === undefined) continue;
      const reported = indexDrift(table, name, index.columns, false, actual);
      if (reported === undefined) continue;
      drift.push(reported);
      // 索引可重建：先删再建，顺序就是数组顺序（同一张表内按定义顺序执行）。
      add({
        table: table.name,
        kind: "drop-index",
        statement: dropIndexSql(dialect, name, options.schema),
      });
      add({
        table: table.name,
        kind: "create-index",
        statement: createIndexSql(dialect, table, name, index, false, options.schema),
      });
    }
    for (const [name, unique] of Object.entries(table.uniques ?? {})) {
      // 唯一约束的判据是「有没有等价的唯一索引」，不是名字：SQLite 的表级 UNIQUE 会建
      // `sqlite_autoindex_*`，按名字判会误报缺失。
      const equivalent = [...(shape?.indexShapes?.values() ?? [])].some(
        (index) => index.unique && sameColumns(index.columns, unique.columns),
      );
      if (equivalent) continue;
      const actual = shape?.indexShapes?.get(name);
      if (actual !== undefined) {
        const reported =
          indexDrift(table, name, unique.columns, true, actual) ??
          ({
            table: table.name,
            kind: "missing-unique",
            fix: "auto",
            detail: `${table.name}.${name}: unique constraint missing`,
          } satisfies SchemaDrift);
        drift.push(reported);
        if (shape?.indexes.has(name) === true) {
          add({
            table: table.name,
            kind: "drop-index",
            statement: dropIndexSql(dialect, name, options.schema),
          });
        }
      } else {
        drift.push({
          table: table.name,
          kind: "missing-unique",
          fix: "auto",
          detail: `${table.name}.${name}: unique constraint missing`,
        });
      }
      // 旧表上补唯一约束只能走唯一索引（不改表定义）。
      add({
        table: table.name,
        kind: "create-index",
        statement: createIndexSql(dialect, table, name, unique, true, options.schema),
      });
    }
  }
  // 库里有、catalog 没有的表：只报告、不删。删表要人决定，而且它可能正是「表定义被删掉」的信号
  //（删掉账本 / 删旧表又不走迁移时，这是唯一的安全网）。
  const defined = new Set(catalog.map((table) => table.name));
  for (const name of [...(options.tables ?? [])].sort()) {
    if (defined.has(name) || name === SCHEMA_MIGRATIONS_TABLE) continue;
    drift.push({
      table: name,
      kind: "orphan",
      fix: "manual",
      detail: `${name}: in database, not in catalog (reported, not dropped)`,
    });
  }
  return { changes, drift };
}

function assertAddable(table: string, name: string, column: ColumnDef): ColumnDef {
  // 已有数据的表加 NOT NULL 列必须带默认值，否则方言会拒绝（或写入空值）。
  if (column.notNull === true && column.default === undefined) {
    throw new Error(
      `zephyr-rdb: cannot add NOT NULL column '${table}.${name}' without a default to an existing table`,
    );
  }
  return column;
}

// 让库结构与表定义对齐：执行可自动修的变更，并把漂移清单一起返回。
export async function ensureSchema(
  database: Database,
  catalog: Catalog,
  options: EnsureSchemaOptions = {},
): Promise<SchemaResult> {
  // schema 是连接上的事实：配置给了就用配置的，没给就跟着连接打开时的有效 schema。
  const schema = options.schema ?? database.schema;
  const shapes = new Map<string, TableShape | undefined>();
  for (const table of catalog) {
    shapes.set(
      table.name,
      await database.dialect.readShape(shapeReader(database), table.name, schema),
    );
  }
  // 库里现有的表名（orphan 的差集基数）：在读完各表结构之后问，语句顺序与结构探测一致。
  const tables = await tableNames(database);
  const plan = planSchema(database.dialect, catalog, shapes, {
    ...options,
    ...(schema === undefined ? {} : { schema }),
    tables,
  });
  for (const change of plan.changes) {
    options.onStatement?.(change.statement);
    await database.run(fragment(change.statement));
  }
  return { statements: plan.changes.map((change) => change.statement), drift: plan.drift };
}

export type { TableShape };
