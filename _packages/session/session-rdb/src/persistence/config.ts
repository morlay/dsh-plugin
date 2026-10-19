import z from "@deepseek-ai/schemastery";
import { DEFAULT_BUSY_TIMEOUT_MS } from "../schema.ts";
// 行配置的形状：sqlite / postgres 两条 union；`ResolvedConfig` 是 schema 解析后的 volatile 形状。
import type { Volatile } from "@deepseek-ai/cosmokit";
import type { JournalMode } from "../schema.ts";

export const DEFAULT_PROJECTION_WRITE_EVERY_EVENTS = 200;

export const DEFAULT_PROJECTION_WRITE_INTERVAL_MS = 5000;

export interface ProjectionCacheOptions {
  writeEveryEvents?: number;

  writeIntervalMs?: number;
}

export type Config =
  | {
      type: "sqlite";
      path: string;
      journalMode?: JournalMode | undefined;
      busyTimeout?: number | undefined;
      projectionCache?: ProjectionCacheOptions | undefined;
    }
  | {
      type: "postgres";
      connectionString: string;
      schema?: string | undefined;
      projectionCache?: ProjectionCacheOptions | undefined;
    };

export type ResolvedConfig = Volatile<Config>;

export const localized = (text: { zh: string; en: string }): string => text as unknown as string;

// 投影 checkpoint 的写回节流：两个分支共用。
export const projectionCacheSchema = z
  .object({
    writeEveryEvents: z
      .natural()
      .min(1)
      .default(DEFAULT_PROJECTION_WRITE_EVERY_EVENTS)
      .description(
        localized({
          zh: "每累计这么多事件写回一次投影 checkpoint。",
          en: "Write the projection checkpoint back after this many events.",
        }),
      ),
    writeIntervalMs: z
      .natural()
      .min(1)
      .default(DEFAULT_PROJECTION_WRITE_INTERVAL_MS)
      .description(
        localized({
          zh: "距离上次写回超过这个间隔（毫秒）时也写一次。",
          en: "Also write back when this many ms passed since the last one.",
        }),
      ),
  })
  .default({
    writeEveryEvents: DEFAULT_PROJECTION_WRITE_EVERY_EVENTS,
    writeIntervalMs: DEFAULT_PROJECTION_WRITE_INTERVAL_MS,
  });

// 行配置 schema（sqlite / postgres union）：`static Config` 与 `RdbController` 共用。
export const ConfigSchema = z
    .union([
      z.object({
        type: z.const("sqlite"),
        path: z
          .string()
          .required()
          .description(
            localized({
              zh: "SQLite 数据库文件路径；`:memory:` 是内存库（进程结束即丢）。",
              en: "SQLite database file path; `:memory:` keeps it in memory and loses it with the process.",
            }),
          ),
        journalMode: z
          .union(["wal", "delete", "truncate", "persist"] as const)
          .default("wal")
          .description(
            localized({
              zh: "SQLite 日志模式；默认 wal（并发读最好）。",
              en: "SQLite journal mode; `wal` by default (best concurrent reads).",
            }),
          ),
        busyTimeout: z
          .number()
          .step(1)
          .min(0)
          .default(DEFAULT_BUSY_TIMEOUT_MS)
          .description(
            localized({
              zh: "写锁冲突时的忙等超时（毫秒）。",
              en: "Busy timeout in ms while a write lock is contended.",
            }),
          ),
        projectionCache: projectionCacheSchema,
      }),
      z.object({
        type: z.const("postgres"),
        connectionString: z
          .string()
          .required()
          .description(
            localized({
              zh: "PostgreSQL 连接串（含库名与凭证）。",
              en: "PostgreSQL connection string (database and credentials).",
            }),
          ),
        schema: z
          .string()
          .default("public")
          .description(
            localized({
              zh: "库内的 schema 名；默认 public。",
              en: "Schema name inside the database; `public` by default.",
            }),
          ),
        projectionCache: projectionCacheSchema,
      }),
    ])
    .description(
      localized({
        zh: "会话持久化后端：改这里的连接参数会在这一行重挂时生效（Loader 会重装被改的行）。",
        en: "Session persistence backend: edits apply when this row is remounted (the Loader re-installs changed rows).",
      }),
    )
    .volatile() as unknown as z<Config, ResolvedConfig>;
