import { Module } from "@morlay/zephyr";
import { WebStartupProvider } from "./web-startup.provider.ts";
import { jsExpr } from "@morlay/zephyr/compat";
import { WebRuntimeService, WebStartup, Webserver } from "./web.service.ts";

@Module({ providers: [
  WebStartupProvider,
  WebStartup,
  Webserver.withConfig({
    host: jsExpr<any>((ctx: any) => ctx.webStartup.host ?? "127.0.0.1"),
    port: jsExpr<any>((ctx: any) => ctx.webStartup.port ?? 3080),
    tls: jsExpr<any>((ctx: any) => ctx.webStartup.tls),
    compression: "gzip",
    compressionLevel: 1,
    compressionThresholdBytes: 1024,
  }),
  WebRuntimeService.withConfig({
    openBrowser: jsExpr<any>((ctx: any) => ctx.webStartup.openBrowser),
    printUrl: true,
    publicUrl: jsExpr<any>((ctx: any) => ctx.webStartup.publicUrl),
    surfaceContext: true,
  }),
] })
export class WebModule {}
