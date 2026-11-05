// 兜底服务契约：页面、本地文件（`/@fs`）、仓库路径拦截、其余交给 vite。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class WebServe {
  abstract handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
