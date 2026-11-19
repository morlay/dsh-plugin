// 装配收尾的日志出口：把行作用域里的 `ctx.logger` 接到 stdout。
//
// 为什么需要它：cordis 的 `ctx.logger` 默认没有 exporter（消息只进内存），所以 `[routes]` / `[rpc]`
// 这类装配观测点在真实启动时看不见——只有单测里通过 `ctx.logger.exporter()` 捕获得到。
import { format } from "node:util";
import { inject, Injectable, Logger } from "@morlay/zephyr";

/** 需要透出的最小 exporter 面（cordis 的 `Exporter`；这里只用到 `export`）。 */
interface ExporterFace {
  export(message: { name?: string; level?: number; args: readonly unknown[] }): void;
}

/**
 * 取 logger 上的 `exporter`（cordis `LoggerService` 的成员，契约 `Logger` 只声明 severity 方法）。
 *
 * 按成员在不在判：没有 exporter 的 logger（替身、精简装配）直接给 `undefined`，调用方跳过即可。
 * @param logger - `inject(Logger)` 拿到的实例。
 * @returns 已绑定 `this` 的 `exporter`，或 `undefined`。
 */
function exporterOf(logger: object): ((exporter: ExporterFace) => void) | undefined {
  const value: unknown = Reflect.get(logger, "exporter");
  return typeof value === "function"
    ? (value as (exporter: ExporterFace) => void).bind(logger)
    : undefined;
}

/**
 * 这一级要不要附调用栈：警告（1）与错误（0）默认附；`ZEPHYR_LOG_STACKS=0` 关掉。
 *
 * 附栈的理由：被吞掉的失败（监听器抛错、被 catch 成一行文案的异常）只剩一句 message，
 * 没有栈就看不出「谁在什么路径上触发的」——补在这里是唯一不用改上游代码的地方。
 */
const STACKS_BY_DEFAULT = process.env.ZEPHYR_LOG_STACKS !== "0";

/**
 * 调用方栈（跳过本文件里固定的几帧）。
 * @param skip - 从 `new Error()` 的栈里跳过的帧数（含第一行 `Error`）。
 * @returns 每帧一行的缩进文本；拿不到栈时为空串。
 */
export function callerStackOf(skip: number): string {
  const stack = new Error().stack;
  if (stack === undefined) return "";
  return stack
    .split("\n")
    .slice(skip)
    .filter((line) => line.trim() !== "")
    .map((line) => `  ${line.trim()}`)
    .join("\n");
}

/**
 * 一条日志的最终文本：格式化 +（警告/错误时）调用栈。
 * @param args - cordis 的 printf 参数。
 * @param level - cordis 的级别（0 最严重）。
 * @param stacks - 是否允许附栈（默认取环境开关）。
 * @returns 要写出的一行或多行文本（不含结尾换行）。
 */
export function logLineOf(
  args: readonly unknown[],
  level: number,
  stacks: boolean = STACKS_BY_DEFAULT,
): string {
  // 用 node 的 `format` 展开 `%s`/`%o` 这类占位符（cordis 的 message.args 就是 printf 参数）。
  const text = format(...(args as [unknown, ...unknown[]]));
  return level <= 1 && stacks ? `${text}\n${callerStackOf(3)}` : text;
}

@Injectable()
export class LoggerExporterDefault {
  private readonly logger = inject(Logger);

  protected onInit(): void {
    const exportWith = exporterOf(this.logger);
    if (exportWith === undefined) return;
    // 装配观测点（路由表、RPC 拦截）属于运行期契约，不是调试探针：所有级别都落 stdout，
    // 严重级别（cordis 的 ERROR=0）落 stderr。cordis 的 level 越小越严重，别再按"越大越严重"过滤。
    exportWith({
      export: (message) => {
        const level = message.level ?? 1;
        const line = logLineOf(message.args, level);
        (level === 0 ? process.stderr : process.stdout).write(`${line}\n`);
      },
    });
  }
}
