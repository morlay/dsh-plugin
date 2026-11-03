import type { Catalog, TableDef } from "./defs.ts";

/** 一个按表名解析的 catalog（装配层注册一次，业务按名字取表）。 */
export interface CatalogIndex {
  get(name: string): TableDef | undefined;
  has(name: string): boolean;
  names(): string[];
}

/** 把表定义列表编成索引（重复表名 fail loud）。 */
export function indexCatalog(catalog: Catalog): CatalogIndex {
  const tables = new Map<string, TableDef>();
  for (const table of catalog) {
    if (tables.has(table.name)) {
      throw new Error(`rdbkit: duplicate table '${table.name}' in catalog`);
    }
    tables.set(table.name, table);
  }
  return {
    get: (name) => tables.get(name),
    has: (name) => tables.has(name),
    names: () => [...tables.keys()],
  };
}
