import { provide } from "@morlay/zephyr";
import { LoggerExporterDefault } from "./logger-exporter.service.ts";

/** 日志出口行：装配收尾把 `ctx.logger` 接到 stdout（`[routes]` / `[rpc]` 这类观测点因此可见）。 */
export const provideLoggerExporter = provide([LoggerExporterDefault]);
