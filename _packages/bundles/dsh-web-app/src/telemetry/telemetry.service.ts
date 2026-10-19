import { DeepseekAccount } from "@morlay/dsh-base/agent";
import { Otel } from "@morlay/dsh-base/telemetry";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis, jsExpr } from "@morlay/zephyr/compat";
import DesktopProductTelemetryPlugin from "@deepseek-ai/dsh-host-product-telemetry-otel";
import ProductAnalyticsPlugin from "@deepseek-ai/dsh-client-product-analytics";

@Injectable()
export class DesktopProductTelemetry extends fromCordis(DesktopProductTelemetryPlugin) {
  otel = inject(Otel);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      otel: this.otel, "scheduledDelayMillis": 30000, "timeoutMillis": 15000, "exportTimeoutMillis": 20000, "shutdownTimeoutMillis": 2000, "serviceName": "deepseek-harness-desktop", "serviceVersion": jsExpr<any>((_ctx: any) => (process.env.DSH_CLIENT_VERSION ?? "0.0.0")), "endpoint": jsExpr<any>((_ctx: any) => (process.env.DSH_PRODUCT_ANALYTICS_OTLP_URL)) });
  }
}

@Injectable()
export class ProductAnalytics extends fromCordis(ProductAnalyticsPlugin) {
  deepseekAccount = inject(DeepseekAccount);

  productTelemetry = inject(DesktopProductTelemetry);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      deepseekAccount: this.deepseekAccount,
      productTelemetry: this.productTelemetry, "enabled": true, "appVersion": jsExpr<any>((_ctx: any) => (process.env.DSH_CLIENT_VERSION ?? "0.0.0")) });
  }
}
