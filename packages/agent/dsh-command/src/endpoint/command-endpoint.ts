// `commands` 这一组的**跨端契约**：组名、组内每个方法的名字与请求/响应形状。
//
// 两端共用同一份声明：宿主侧实现它（`server/`），浏览器侧按它消费（`ui/` 的 remote 实现）。
// 契约是普通类：客户端形态（`@RemoteClient()`）与宿主形态各自继承它。
// **它不继承 `RemoteClientBase`**：那个基类带一个 `inject(Remote)` 字段，而 `Remote` 只有浏览器侧有；
// 契约被两端共用，继承它会让宿主装配去解析一个不存在的服务。
//
// **这一组是自研 wire**（我们挂自己的 descriptor，不挂上游 `@deepseek-ai/dsh-commands/remote`）：
// 上游那条 remote 的两个端点都带 `scope: { context: 'agent' }` + `lookup`（wire 传 id、网关解析成
// `Agent`），本装配的 mux 载具不做 scope/lookup 解析。所以我们只沿用上游的**调用形状**（位置参数、
// 整行、附件），名字用本仓词汇（`sessionId`）。**形状有上游类型可守**：文件末尾的
// `CommandEndpointCovered` 对上游 `commands` 那条 wire 面的裸值视图；descriptor 的参数名与宿主入参映射
// 另由 `__tests__/command-endpoint-wire.spec.ts` 钉住。
import { RemoteGroup, RemoteMethod } from "@morlay/zephyr-app/remote";
import type { AssertTrue, AssertWireFace } from "@morlay/zephyr-app/client";
import type { AsyncReturn, DropParam, MapParam } from "@morlay/zephyr-app/typert";
import type { Agent } from "@morlay/dsh-agent";
import type { SessionId } from "@morlay/dsh-session/endpoint";
import type CommandRuntime from "@deepseek-ai/dsh-commands";
import type { CommandExecution, CommandSubmitAttachment } from "@deepseek-ai/dsh-commands/types";
import type { CommandEntry } from "@morlay/dsh-command/contract";

/** `commands/list` 的请求。 */
export interface CommandListRequest {
  readonly sessionId: string;
}

/**
 * `commands/list` 的响应：**裸数组**。
 *
 * 消费方是上游 `ui-commands` 的目录（`const list = await ctx.remote.commands.list(id)` 之后直接迭代），
 * 包一层 `{ commands }` 会让它报 `list is not iterable`。
 */
export type CommandListValue = readonly CommandEntry[];

/**
 * `commands/execute` 的响应：上游 `CommandExecution`（`commandId` 生命周期配对 id + 归一化结果）。
 *
 * **直接取上游那份**：手抄过一次（`commandId: string` 对 branded、`result` 手写联合），形状漂了只能靠
 * 运行时发现。`result` 是判别式联合（`success` / `error`），消费方按 `kind` 分派。
 */
export type CommandExecuteValue = CommandExecution;

/**
 * 执行配对 id 的**铸点**（上游 `CommandId` 品牌工厂，纯函数）。
 *
 * 两个用处：宿主在「注册表里没有这条命令」时回一条结构化失败（需要一个配对 id），以及测试替身构造
 * `CommandExecuteValue`。契约面允许「品牌工厂」这类纯值，所以从 `@deepseek-ai/dsh-commands/src/brand.ts`
 * 转出，消费方不必各自去 import 上游深路径。
 */
export { CommandId } from "@deepseek-ai/dsh-commands/src/brand.ts";

/** `commands` 组：列目录、执行命令。 */
@RemoteGroup({ name: "commands" })
export class CommandEndpoint {
  /**
   * 列出某个会话可见的命令。
   *
   * wire 是**一个位置参数** `{ sessionId }`：上游消费方（`ui-commands` 的目录）按
   * `remote.commands.list(sessionId)` 传位置标量；声明了 `parameters` 之后宿主也按位置取。
   * @param _sessionId - 会话 id（上游称 agent id）。
   * @returns 目录（未知会话给空数组）。
   */
  @RemoteMethod({ parameters: ["sessionId"] })
  async list(_sessionId: SessionId): Promise<CommandListValue> {
    throw new Error("commands/list：契约类未实现（宿主侧要在子类里实现它）");
  }

  /**
   * 执行一条命令。
   *
   * **wire 是三个位置参数**（`{ sessionId, line, submittedAttachments }`），不是"一个请求对象"：
   * 上游的消费方全都按位置调（`ui-commands` 的 `ctx.remote.commands.execute(sessionId, line, attachments)`、
   * `ui-plan` 的 `execute(sessionId, '/plan off', [])`、会话面的 `execute(this.sessionId, line, [])`）。
   * 之前这里没声明 `parameters`，descriptor 把第一个实参编成 `request`，于是整行与附件都丢了、
   * 宿主只拿到一个字符串——真机上的症状是 `commands/execute: 缺少会话或命令名`。
   * @param _sessionId - 目标会话（上游称 agent id）。
   * @param _line - **整行**（`/plan off`）：上游协议就是传整行，拆分在宿主侧做（`splitCommandLine`）。
   * @param _submittedAttachments - 随命令提交的附件；本装配的命令都不消费它们（见债：命令附件未接线）。
   * @returns 注册表给出的执行结果。
   */
  @RemoteMethod({ parameters: ["sessionId", "line", "submittedAttachments"] })
  async execute(
    _sessionId: SessionId,
    _line: string,
    _submittedAttachments: readonly CommandSubmitAttachment[],
  ): Promise<CommandExecuteValue | undefined> {
    throw new Error("commands/execute：契约类未实现（宿主侧要在子类里实现它）");
  }
}

/**
 * **上游 `commands` 的 wire 面**：从宿主类 `CommandRuntime` 投影出来，三步（规则与出处见
 * `@morlay/zephyr-app/typert` 的 `params.ts`）：`DropParam`（末尾 `signal` 走 cancellation）→
 * `MapParam`（lookup：`Agent` → `SessionId`）→ `AsyncReturn`（wire 上每次调用都是异步的）。
 *
 * 业务类型只出现在这一行组合里——框架那三个工具不认识 `Agent` / `SessionId` / `AbortSignal`。
 */
type CommandsWire = AsyncReturn<MapParam<DropParam<CommandRuntime, AbortSignal>, Agent, SessionId>>;

/**
 * 覆盖守卫：契约对上**宿主类**的 wire 面（见 {@link CommandsWire}）。
 *
 * 这一组是自研 wire（不挂上游 descriptor：它的端点带 `scope`/`lookup`，本装配的载具不解析），但
 * **调用形状**是上游的协议——签名漂了（像 `execute` 曾经漏掉 `parameters`、只收一个 `request`）就红。
 *
 * 部分覆盖：宿主类还有 `register` / `find` / `registerFileReceiptResolver` 这些**不进 wire** 的方法，所以
 * 覆盖范围**显式列在下面的 `Pick` 里**（按 `keyof CommandEndpoint` 取会放过「契约掉了一个端点」这种退化）。
 * `Pick` 还守住另一半：契约声明了宿主类没有的端点，它自己会报。
 */
export type CommandEndpointCovered = AssertTrue<
  AssertWireFace<Pick<CommandsWire, "list" | "execute">, CommandEndpoint>
>;
