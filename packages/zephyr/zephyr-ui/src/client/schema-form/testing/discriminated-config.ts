// 判别式行 Config 的样例形状：共享的 `type` 标签 + 各分支自己的字段与默认值。
//
// 它原来是 `session-rdb` 那份真配置；那一行在本仓库还没落地（`@morlay/zephyr-rdb` 单独迁），
// 所以把它按同一形状留在这里当 fixture：行投影认的是 schema 的形状，不是它属于哪一行。
import z from "@deepseek-ai/schemastery";

const preparedSessionCacheSize = z.number().step(1).min(1).default(1);

export const discriminatedConfig = z.union([
  z.object({
    type: z.const("sqlite"),
    path: z.string().required(),
    journalMode: z.union(["wal", "delete"] as const).default("wal"),
    busyTimeout: z.number().step(1).min(0).default(1000),
    preparedSessionCacheSize,
  }),
  z.object({
    type: z.const("postgres"),
    connectionString: z.string().required(),
    schema: z.string().default("public"),
    preparedSessionCacheSize,
  }),
]);
