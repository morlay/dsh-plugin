// 前端资产契约：页面兜底与静态资源**怎么出**是形态问题，不是运行时问题。
//
// dev 由开发运行时出（vite 逐文件 + 按包联邦产物），prod 由静态目录出（读 `client_modules/`）。
// `zephyr-app` 只声明这条缝：它不认 vite、不认产物布局；谁实现由装配面装进来的行决定
// （见 `zephyr/.agents/designs/20261113-开发构建与产物布局.md`）。
import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable } from "@morlay/zephyr";

/**
 * 联邦产物的地址前缀：`/_zephyr/@modules/<pkg>@<ver>/<file>`（开发态与生产态同一段）。
 *
 * 它是**地址空间**的事实，归契约：生产态的实现（静态目录投递）与页面兜底都按同一段认路径，
 * 各写一份就等于把一个地址两处定义。
 */
export const CLIENT_MODULES_PREFIX = "/_zephyr/@modules";

@Injectable()
export abstract class ClientAssets {
  /**
   * 把请求交给前端资产。
   * @param req - 进来的请求。
   * @param res - 应答的对象。
   * @returns 已应答为 `true`（调用方不再往下传）；`false` 表示这条请求不归它。
   */
  abstract serve(req: IncomingMessage, res: ServerResponse): Promise<boolean> | boolean;

  /**
   * 改写页面骨架（dev 的 vite 会注入 HMR 客户端与入口 script）。
   * @param html - 骨架原文。
   * @returns 改写后的 HTML。
   */
  abstract transformHtml(html: string): Promise<string>;

  /** HMR 通道是否挂着（没有同源 http server 的形态不注入 HMR 客户端）。 */
  abstract readonly hmr: boolean;

  /**
   * 订阅**服务端源码**的变化（`src/client/**` 与 `src/ui/**` 不报：那半由前端资产自己热更）。
   *
   * 这条边放在**资产**侧而不是 `DevHmr` 上：变更来源属于「谁在服务前端资产」（dev 的 vite），
   * 而 `DevHmr` 只管「什么时候可以换树」。生产态没有变更源，实现返回一个空撤销函数即可。
   * @param listener - 收到变化的绝对路径。
   * @returns 撤销函数。
   */
  abstract onServerSourceChange(listener: (file: string) => void): () => void;
}
