// 测试用的行替身：真接口、记录调用，不起真服务（WebServer 用真的，见各 spec）。
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { Injectable } from "@morlay/zephyr";
import { type AppEnvValues } from "../../app-env/app-env.contract.ts";
import { AppEnv } from "../../app-env/app-env.contract.ts";
import { Federation } from "../../federation/federation.contract.ts";
import { WebServe } from "../../http/serve.contract.ts";
import { ViteHandoff } from "../../vite-handoff/vite-handoff.contract.ts";
import { WebStartup } from "../../web/web-startup.contract.ts";

interface LogExporter {
  exporter(exporter: { export(message: { args: readonly unknown[] }): void }): () => void;
}

/** 把 root ctx 的日志收成一行行文本（`logger.info(fmt, ...args)` 的原始参数）。 */
export function captureLogs(ctx: Context): string[] {
  const lines: string[] = [];
  (ctx.logger as unknown as LogExporter).exporter({
    export: (message) => {
      lines.push(message.args.map((arg) => String(arg)).join(" "));
    },
  });
  return lines;
}

/** 轮询直到条件成立（异步注册点：上游 `ctx.inject` 回调不在装配返回前完成）。 */
export async function until(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("等待超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

@Injectable()
export class TestWebStartup extends WebStartup {
  readonly values = { host: "127.0.0.1", port: 0, trustedHosts: [] };
}

@Injectable()
export class TestAppEnv extends AppEnv {
  readonly values: AppEnvValues = {
    profileDir: process.cwd(),
    dataDir: join(tmpdir(), "dsh-zephyr-app-test"),
    dev: true,
    aggregate: [],
  };

  readonly cacheDir = join(tmpdir(), "dsh-zephyr-app-test-cache");

  readonly packageRoot = process.cwd();

  readonly appBootDir = join(process.cwd(), "src", "client", "app-boot");

  readonly profileManifest = join(process.cwd(), "package.json");
}

@Injectable()
export class TestFederation extends Federation {
  readonly urls: string[] = [];

  async serve(url: string, _req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    this.urls.push(url);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("federation");
    return true;
  }

  async depsUrl(): Promise<string | undefined> {
    return undefined;
  }
}

@Injectable()
export class TestWebServe extends WebServe {
  calls = 0;

  async handle(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.calls += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("fallback");
  }
}

@Injectable()
export class TestViteHandoff extends ViteHandoff {
  readonly upgrades: { req: IncomingMessage; socket: Duplex; head: Buffer }[] = [];

  serve(): boolean {
    return false;
  }

  async transformHtml(html: string): Promise<string> {
    return html;
  }

  hmrUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.upgrades.push({ req, socket, head });
    socket.end();
  }

  readonly hmr = true;

  async dispose(): Promise<void> {}
}
