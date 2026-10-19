import { SessionTelemetryMode } from "@deepseek-ai/dsh-session-telemetry-otel";
import { LogExporterOptions } from "@deepseek-ai/dsh-otel";
import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { OtelDefault } from "./otel.service.ts";
import { SessionTelemetryOtel } from "./session-telemetry-otel.service.ts";

// 配置在**装配期**求值（`jsExpr` 只对 `fromCordis` 的适配行生效）；
// 环境变量只在这里读一次（初始化期），之后一律走注入/显式值。
const providers = (): ProviderList => [
  OtelDefault,
  configure(SessionTelemetryOtel, {
    mode: (process.env.DSH_TELEMETRY_MODE || "FEEDBACK_ONLY") as SessionTelemetryMode,
    shutdownTimeoutMillis: 3000,
    maxRequestBytes: 4_000_000,
    exporter: {
      url:
        process.env.DSH_TELEMETRY_OTLP_URL ??
        "https://dsh-otel-collector.deepseeksvc.com/v1/logs",
      compression: "gzip" as NonNullable<LogExporterOptions["compression"]>,
      timeoutMillis: 1000,
    },
    processor: {
      scheduledDelayMillis: 10_000,
      maxQueueSize: 2048,
      maxExportBatchSize: 2048,
      exportTimeoutMillis: 1500,
    },
  })([SessionTelemetryOtel]),
];

export const provideTelemetry = provide(providers());
