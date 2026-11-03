import { defineTable } from "@morlay/rdbkit";

// 所有 storage 域共用这一张表：(域, 表, 键) 一行，值是整份记录文档。域是行的一部分，所以新增域
// （不论它自带几张表、还是只有 global 槽）都不需要再建表——上游 `KvUnit` 的契约本来就只要求
// 「按表名读写记录 + 一个 global 单例」，行存储直接承载它。global 单例用 `f_table = ''`。
export const storageRecords = defineTable({
  name: "t_storage_records",
  columns: {
    f_domain: { type: "text", notNull: true },
    f_table: { type: "text", notNull: true },
    f_key: { type: "text", notNull: true },
    f_value: { type: "text", notNull: true },
  },
  uniques: {
    uq_storage_records_domain_table_key: { columns: ["f_domain", "f_table", "f_key"] },
  },
});
