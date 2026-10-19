import { provide } from "@morlay/zephyr";
import { WebRuntimeService } from "./web-runtime.service.ts";
import { WebServerDefault } from "./web-server.service.ts";
import { WebStartupDefault } from "./web-startup.service.ts";

// `WebRuntimeService` 负责打印带 token 的 URL（dev 形态的入口提示）；它不挂前端静态产物。
export const provideWeb = provide([WebStartupDefault, WebServerDefault, WebRuntimeService]);
