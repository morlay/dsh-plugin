// 命令行的**拼装与拆分**：`/name input` 的规则只在这里写一份。
//
// 为什么需要两向：wire 上的 `commands/execute` 传的是**整行**（上游客户端就是这么调的：
// `remote.commands.execute(sessionId, "/plan off", [])`），而注册表的执行入口、我们的
// `CommandRunner.run(sessionId, name, input)`、以及同进程端口都是「名字 + 输入」两段。
// 两段 ↔ 整行的转换只此一处：客户端拼、宿主拆，规则漂了就是「命令名里多了个斜杠」这类静默错。

/**
 * 由名字与输入拼出一行。
 * @param name - 命令名（带不带前导 `/` 都行）。
 * @param input - 名字后面的输入；`undefined` 与空串都表示没有。
 * @returns 以 `/` 开头的命令行。
 */
export function commandLineOf(name: string, input?: string): string {
  const bare = name.startsWith("/") ? name.slice(1) : name;
  return input === undefined || input === "" ? `/${bare}` : `/${bare} ${input}`;
}

/**
 * 拆出一行的名字与输入（首个空格为界；名字不带前导 `/`）。
 * @param line - 以 `/` 开头的命令行（没有前导 `/` 也按同一规则拆）。
 * @returns 命令名（可能是空串：只有空白输入）与它后面的输入。
 */
export function splitCommandLine(line: string): {
  readonly name: string;
  readonly input: string | undefined;
} {
  const text = line.startsWith("/") ? line.slice(1) : line;
  const separator = text.indexOf(" ");
  if (separator === -1) return { name: text, input: undefined };
  return { name: text.slice(0, separator), input: text.slice(separator + 1) };
}
