import { Module } from "@morlay/zephyr";
import { WebRuntimeService } from "./web-runtime.service.ts";
import { WebServerDefault } from "./webserver.service.ts";
import { WebStartupDefault } from "./web-startup.service.ts";

// `WebRuntimeService` 负责打印带 token 的 URL（dev 形态的入口提示）；它不挂前端静态产物。
@Module({ providers: [WebStartupDefault, WebServerDefault, WebRuntimeService] })
export class WebModule {}
