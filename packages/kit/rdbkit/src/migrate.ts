import {
  addColumnSql,
  createIndexSql,
  createTableSql,
  dropColumnSql,
  type Dialect,
  type TableShape,
} from "./dialect.ts";
import type { Catalog, ColumnDef } from "./defs.ts";
import type { Database } from "./database.ts";
import { shapeReader } from "./database.ts";
import { fragment } from "./fragment.ts";

/** 一条结构变更（按顺序执行）。 */
export interface SchemaChange {
  readonly table: string;
  readonly kind: "create-table" | "add-column" | "create-index" | "drop-column";
  readonly statement: string;
}

export interface EnsureSchemaOptions {
  /** PostgreSQL 的 schema（默认 `public`）；SQLite 忽略。 */
  schema?: string;
  /** 允许删掉定义里已经不存在、且确实多出来的列（默认关闭：升级不丢数据）。 */
  allowDestructive?: boolean;
  /** 需要看到实际执行的语句时（排查 / 测试）。 */
  onStatement?: (statement: string) => void;
}

/**
 * 结构差异（纯函数）：缺表建表、缺列补列、缺索引补索引。
 *
 * 只做「增」——不删列、不改类型、不删索引：旧库升级不会丢数据，破坏性变更由调用方显式处理。
 * @param dialect - 目标方言。
 * @param catalog - 表定义（唯一事实来源）。
 * @param shapes - 现有结构（表名 → 列 / 索引；不存在则 undefined）。
 * @param options - schema 名。
 * @returns 需要执行的变更，按依赖顺序（表 → 列 → 索引）。
 */
export function planSchema(
  dialect: Dialect,
  catalog: Catalog,
  shapes: ReadonlyMap<string, TableShape | undefined>,
  options: { schema?: string; allowDestructive?: boolean } = {},
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  for (const table of catalog) {
    const shape = shapes.get(table.name);
    if (shape === undefined) {
      changes.push({
        table: table.name,
        kind: "create-table",
        statement: createTableSql(dialect, table, options.schema),
      });
    } else {
      for (const [name, column] of Object.entries(table.columns)) {
        if (shape.columns.has(name)) continue;
        changes.push({
          table: table.name,
          kind: "add-column",
          statement: addColumnSql(
            dialect,
            table.name,
            name,
            assertAddable(table.name, name, column),
          ),
        });
      }
      if (options.allowDestructive === true) {
        for (const name of shape.columns) {
          if (table.columns[name] !== undefined) continue;
          changes.push({
            table: table.name,
            kind: "drop-column",
            statement: dropColumnSql(dialect, table.name, name),
          });
        }
      }
    }
    for (const [name, index] of Object.entries(table.indexes ?? {})) {
      if (shape?.indexes.has(name) === true) continue;
      changes.push({
        table: table.name,
        kind: "create-index",
        statement: createIndexSql(dialect, table, name, index.columns),
      });
    }
    for (const [name, unique] of Object.entries(table.uniques ?? {})) {
      if (shape?.indexes.has(name) === true) continue;
      // 旧表上补唯一约束只能走唯一索引（不改表定义）。
      changes.push({
        table: table.name,
        kind: "create-index",
        statement: createIndexSql(dialect, table, name, unique.columns, true),
      });
    }
  }
  return changes;
}

function assertAddable(table: string, name: string, column: ColumnDef): ColumnDef {
  // 已有数据的表加 NOT NULL 列必须带默认值，否则方言会拒绝（或写入空值）。
  if (column.notNull === true && column.default === undefined) {
    throw new Error(
      `rdbkit: cannot add NOT NULL column '${table}.${name}' without a default to an existing table`,
    );
  }
  return column;
}

/** 让库结构与表定义对齐，并返回实际执行的语句。 */
export async function ensureSchema(
  database: Database,
  catalog: Catalog,
  options: EnsureSchemaOptions = {},
): Promise<string[]> {
  const shapes = new Map<string, TableShape | undefined>();
  for (const table of catalog) {
    shapes.set(
      table.name,
      await database.dialect.readShape(shapeReader(database), table.name, options.schema),
    );
  }
  const changes = planSchema(database.dialect, catalog, shapes, options);
  for (const change of changes) {
    options.onStatement?.(change.statement);
    await database.run(fragment(change.statement));
  }
  return changes.map((change) => change.statement);
}

export type { TableShape };
