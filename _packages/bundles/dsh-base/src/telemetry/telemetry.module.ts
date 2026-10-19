import { SessionTelemetryMode } from "@deepseek-ai/dsh-session-telemetry-otel";
import type { LogExporterOptions } from "@deepseek-ai/dsh-otel";
import { Module, type ProviderList } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { OtelDefault } from "./otel.service.ts";
import { SessionTelemetryOtel } from "./session-telemetry-otel.service.ts";

const providers = (): ProviderList => [
  OtelDefault,
  SessionTelemetryOtel.withConfig({
    mode: jsExpr<SessionTelemetryMode>(
      () =>
        (process.env.DSH_TELEMETRY_MODE ||
          "FEEDBACK_ONLY") as SessionTelemetryMode,
    ),
    shutdownTimeoutMillis: 3000,
    maxRequestBytes: 4_000_000,
    exporter: {
      url: jsExpr(
        () =>
          process.env.DSH_TELEMETRY_OTLP_URL ??
          "https://dsh-otel-collector.deepseeksvc.com/v1/logs",
      ),
      compression: "gzip" as NonNullable<LogExporterOptions["compression"]>,
      timeoutMillis: 1000,
    },
    processor: {
      scheduledDelayMillis: 10_000,
      maxQueueSize: 2048,
      maxExportBatchSize: 2048,
      exportTimeoutMillis: 1500,
    },
  }),
];

@Module({ providers: providers() })
export class TelemetryModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
