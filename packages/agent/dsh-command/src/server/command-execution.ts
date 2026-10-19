// 按名字执行一条命令：`/name input` 的拼装、上游执行入口、以及「命令不存在」的判空，都只在这里写。
//
// 两个调用点（`command-endpoint.service.ts` 的 wire 方法、`registry-runner.ts` 的同进程端口）用同一份，
// 差别只有报错前缀（`where`）。
import type CommandRuntime from "@deepseek-ai/dsh-commands";

/** 一次命令执行要的东西。 */
export interface CommandRun {
  /** 命令注册表的执行面（上游 `CommandRuntime["execute"]`）。 */
  readonly registry: Pick<CommandRuntime, "execute">;

  /** 目标 agent（会话已在调用方解析过）。 */
  readonly agent: Parameters<CommandRuntime["execute"]>[0];

  /** 命令名（不含斜杠）。 */
  readonly name: string;

  /** 名字后面的输入，原样拼进命令行；没有就 `undefined`。 */
  readonly input: string | undefined;

  /** 报错前缀：wire 侧 `commands/execute`、同进程侧 `commands`。 */
  readonly where: string;
}

/**
 * 执行一条命令。
 * @param options - 注册表、agent、名字与输入、报错前缀。
 * @returns 上游的执行结果（`commandId` + `result`）。
 * @throws 名字解析不到时抛错（上游对语法错或未知名字返回 `undefined`）。
 */
export async function runCommand(
  options: CommandRun,
): Promise<Awaited<ReturnType<CommandRuntime["execute"]>>> {
  const line = `/${options.name}${options.input === undefined ? "" : ` ${options.input}`}`;
  // 上游 `execute` 要一个 signal（它的 typert 客户端可以按调用传），但我们的入口链上**没有取消源**：
  // `CommandRunner.run` 不带 signal，wire 上一元的 `@RemoteMethod` 走 `RemoteHandlers.invoke(args)`，
  // 也只有 stream 那一路才拿得到 signal。这里给一个不会 abort 的 controller——要真能取消，
  // 得先让入口（契约 + wire 请求）把 signal 带进来。
  const execution = await options.registry.execute(
    options.agent,
    line,
    [],
    new AbortController().signal,
  );
  if (execution === undefined) throw new Error(`${options.where}: 没有命令 "${options.name}"`);
  return execution;
}
