/**
 * preload 的**源码**由服务现场打包成 CJS 交给壳，装配目录里因此不再有 `dist/`。
 *
 * 为什么需要它：sandboxed preload 有三个硬约束——只能 CJS、不能 ESM、不能 `require` 第三方（因此也挂不了
 * 本仓库那套 TS hooks）。而它的源码是 TS（还跨几个文件：`preload-app.ts` 拉 `./stream-uplink.ts` 那些），
 * 所以只能**打成单文件 CJS**——打包这件事放在这里做，壳就不必在装配时预先产出一份 `dist/`。
 *
 * 谁来取：壳在窗口创建之前（那时宿主已经就绪）取回来落盘，再把路径交给 `BrowserWindow` 的 `preload`。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { rolldown } from "rolldown";
import type { Context } from "@deepseek-ai/cordis";

/** 壳取 preload 的路径（`GET` 它得到可执行的 CJS 字节）。 */
export const PRELOAD_SOURCE_PATH = "/@dsh/preload.cjs";

export interface PreloadSourceOptions {
  /** 壳包所在的目录（app 目录）：preload 的源码在它的 `src/` 下。 */
  readonly shellRoot: string;
}

/**
 * 把 preload 打包成单文件 CJS。
 *
 * @param options - 见 {@link PreloadSourceOptions}。
 * @returns CJS 源码。
 */
export async function bundlePreload(options: PreloadSourceOptions): Promise<string> {
  const bundle = await rolldown({
    input: join(options.shellRoot, "src", "preload-app.ts"),
    platform: "node",
    // preload 里只能 require Electron 自己给的模块。
    external: ["electron"],
  });
  try {
    const { output } = await bundle.generate({ format: "cjs", inlineDynamicImports: true });
    const chunk = output.find((item) => item.type === "chunk");
    if (chunk === undefined) throw new Error("dsh desktop: preload bundling produced no chunk");
    return chunk.code;
  } finally {
    await bundle.close();
  }
}

/**
 * 在宿主的 webServer 上注册 `/@dsh/preload.cjs`：壳按这条路径取走 preload 的 CJS 字节。
 *
 * @param ctx - 宿主上下文（拿 `webServer`）。
 * @param options - 见 {@link PreloadSourceOptions}。
 */
export function installPreloadSource(ctx: Context, options: PreloadSourceOptions): void {
  const serve = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      try {
        const code = await bundlePreload(options);
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          // 每次都现场打包：不许缓存（源码可能刚改过，dev 下尤其）。
          "cache-control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : code);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.error(`dsh desktop: preload bundling failed: ${message}`);
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(`dsh desktop: preload bundling failed: ${message}`);
      }
    })();
  };
  ctx.effect(
    () =>
      ctx.webServer.register({ kind: "exact", path: PRELOAD_SOURCE_PATH, handler: serve }),
    `dsh-desktop-host: ${PRELOAD_SOURCE_PATH}`,
  );
}
