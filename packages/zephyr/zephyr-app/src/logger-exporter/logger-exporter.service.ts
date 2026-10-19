// 装配收尾的日志出口：把行作用域里的 `ctx.logger` 接到 stdout。
//
// 为什么需要它：cordis 的 `ctx.logger` 默认没有 exporter（消息只进内存），所以 `[routes]` / `[rpc]`
// 这类装配观测点在真实启动时看不见——只有单测里通过 `ctx.logger.exporter()` 捕获得到。
import { format } from "node:util";
import { inject, Injectable, Logger, type Context } from "@morlay/zephyr";

/** 需要透出的最小 exporter 面（cordis 的 `Exporter`；这里只用到 `export`）。 */
interface ExporterFace {
  export(message: { name?: string; level?: number; args: readonly unknown[] }): void;
}

/** `ctx.logger` 上注册 exporter 的方法（`LoggerService` 面，契约只暴露了 severity 方法）。 */
interface LoggerWithExporter extends Logger {
  exporter(exporter: ExporterFace): void;
}

@Injectable()
export class LoggerExporterDefault {
  private readonly logger = inject(Logger) as LoggerWithExporter;

  protected onInit(ctx: Context): void {
    void ctx;
    if (typeof this.logger.exporter !== "function") return;
    // 装配观测点（路由表、RPC 拦截）属于运行期契约，不是调试探针：所有级别都落 stdout，
    // 严重级别（cordis 的 ERROR=0）落 stderr。cordis 的 level 越小越严重，别再按"越大越严重"过滤。
    this.logger.exporter({
      export: (message) => {
        const level = message.level ?? 1;
        // 用 node 的 `format` 展开 `%s`/`%o` 这类占位符（cordis 的 message.args 就是 printf 参数）。
        const text = format(...(message.args as [unknown, ...unknown[]]));
        (level === 0 ? process.stderr : process.stdout).write(`${text}\n`);
      },
    });
  }
}
