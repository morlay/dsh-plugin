// vite handoff 契约：dev server 的启停与「交给 vite 处理」的那一跳。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class ViteHandoff {
  /** 把请求交给 vite；返回 true 表示已应答。 */
  abstract serve(req: IncomingMessage, res: ServerResponse): boolean;

  /** 让 vite 渲染 HTML（`transformIndexHtml` 会注入入口 script）。 */
  abstract transformHtml(html: string): Promise<string>;

  /** HMR 通道是否挂着（无同源 http server 的形态不注入 HMR 客户端）。 */
  abstract readonly hmr: boolean;

  /**
   * 订阅**服务端源码**的变化：`change` / `add` / `unlink` 都算。
   *
   * 只报服务端那半（`src/client/**`、`src/ui/**` 走 vite 自己的 HMR，不该触发行的重载）。
   * 没有 dev server 时不报任何东西。
   * @param listener - 收到变化的绝对路径。
   * @returns 撤销函数。
   */
  abstract onServerSourceChange(listener: (file: string) => void): () => void;

  abstract dispose(): Promise<void>;
}
