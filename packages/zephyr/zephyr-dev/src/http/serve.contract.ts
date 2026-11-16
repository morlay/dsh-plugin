// 兜底服务契约：页面、本地文件（`/@fs`）、仓库路径拦截、其余交给 vite。
//
// **它是开发运行时的接缝**（实现 `ServeDefault` 要认 vite 的 URL 空间），所以住 `zephyr-dev`；
// `zephyr-app` 只提供 `WebServer`（路由表）与两条空契约。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class WebServe {
  abstract handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
