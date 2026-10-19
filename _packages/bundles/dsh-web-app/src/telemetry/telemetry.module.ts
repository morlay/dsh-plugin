import { Module } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { DesktopProductTelemetry, ProductAnalytics } from "./telemetry.service.ts";

@Module({ providers: [DesktopProductTelemetry.withConfig({ "scheduledDelayMillis": 30000, "timeoutMillis": 15000, "exportTimeoutMillis": 20000, "shutdownTimeoutMillis": 2000, "serviceName": "deepseek-harness-desktop", "serviceVersion": jsExpr<any>((_ctx: any) => (process.env.DSH_CLIENT_VERSION ?? "0.0.0")), "endpoint": jsExpr<any>((_ctx: any) => (process.env.DSH_PRODUCT_ANALYTICS_OTLP_URL)) }), ProductAnalytics.withConfig({ "enabled": true, "appVersion": jsExpr<any>((_ctx: any) => (process.env.DSH_CLIENT_VERSION ?? "0.0.0")) })] })
export class TelemetryModule {}
