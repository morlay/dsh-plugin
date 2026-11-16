// dev 形态的前端资产：两个口都委托 vite（`ViteHandoff`）。
//
// 它在 `zephyr-dev`：`ClientAssets` 是 `zephyr-app` 的空契约，实现要 vite——那是构建链。
import type { IncomingMessage, ServerResponse } from "node:http";
import { inject, Injectable } from "@morlay/zephyr";
import { ClientAssets } from "@morlay/zephyr-app";
import { ViteHandoff } from "../vite-handoff/vite-handoff.contract.ts";

@Injectable()
export class ViteClientAssets extends ClientAssets {
  private readonly vite = inject(ViteHandoff);

  serve(req: IncomingMessage, res: ServerResponse): boolean {
    return this.vite.serve(req, res);
  }

  /**
   * 页面骨架的改写。
   *
   * 现在**没人用它**（`ServeDefault` 的页面仍是自己注入入口）——页面骨架的生产态投递
   * 在 T3 落地，那时这一步按 `client_modules/` 改写入口地址。这里先原样返回。
   * @param html - 骨架原文。
   * @returns 原样。
   */
  async transformHtml(html: string): Promise<string> {
    return html;
  }

  get hmr(): boolean {
    return this.vite.hmr;
  }

  onServerSourceChange(listener: (file: string) => void): () => void {
    return this.vite.onServerSourceChange(listener);
  }
}
