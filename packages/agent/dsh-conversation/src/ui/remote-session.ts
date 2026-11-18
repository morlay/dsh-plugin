// 上游 `SessionManager` 要的三组面：`session` 以**我们的 `SessionRemote` 契约服务**为主，
// `commands` / `subagents` 接 `Remote` 的 namespace。
//
// 为什么一元方法不走 namespace：`Remote.session` 要 `$mount` 之后才存在，而 `SessionRemote`
// 是装配时就有的契约服务（所有 spec 的替身都实现它）。接 namespace 会让测试替身失效
// （「会话组还没挂上时 `list` 不是函数」），也会把"装配期就能用"变成"必须等 $mount"。
//
// 为什么流式方法反过来走 namespace：`follow` / `control` 这类长流只在真机上有生成面，
// 契约服务不声明它们——声明了，每个只关心目录的替身都得再实现一遍空流。
import { RemoteStream, type RemoteStreamOptions } from "@deepseek-ai/dsh-api-gateway/client";
import type { SessionRemotes } from "@deepseek-ai/dsh-api-session-controller/src/client/sessions/remotes.ts";
import type { CommandRunner } from "@morlay/dsh-command/endpoint";
import type { Connection, Remote, SessionRemote } from "@morlay/zephyr-app/client";
import { namespaceOf } from "./remote-namespace.ts";

/**
 * 没有连接面时的单代 generation：纯数据面测试按一代跑，重连等待永不触发。
 * @returns 恒定的一代。
 */
function singleGeneration(): Pick<Connection["generation"], "getSnapshot" | "subscribe"> {
  return {
    getSnapshot: () => ({ id: 0, host: { home: "" } }),
    subscribe: () => () => {},
  };
}

/** 一次命令调用的结算面：成功给上游要的 `{ matched }`，失败给 `code` / `message`。 */
type CommandsWireResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/**
 * 把一次调用结果转发出去：逐帧面（异步迭代器）原样给，一元结果包成上游要的 `RemoteResult`。
 * @param outcome - 成员调用返回的 Promise 或值。
 * @returns 上游要的形状。
 */
function forwarded(outcome: unknown): unknown {
  if (outcome !== null && typeof outcome === "object" && Symbol.asyncIterator in outcome)
    return outcome;
  return asRemoteResult(outcome);
}

/** 上游 `SessionRemotes` 的活实现。 */
export class LiveSessionRemotes implements SessionRemotes {
  /**
   * @param sessionRemoteOf - 取我们的 `SessionRemote` 契约服务（装配期就有）。
   * @param commandRunnerOf - 取我们的 `CommandRunner` 契约服务（上游 `commands.execute` 映射到它）。
   * @param remoteOf - 取 `Remote` 面（`subagents` 这个 namespace 从这里来）。
   * @param connectionOf - 取连接面：上游 `RemoteStream` 用它跟连接代换代（没装就给单代）。
   */
  constructor(
    private readonly sessionRemoteOf: () => SessionRemote,
    private readonly commandRunnerOf: () => CommandRunner,
    private readonly remoteOf: () => Remote,
    private readonly connectionOf: () => Connection | undefined,
  ) {}

  /**
   * 上游 `ClientRemote` 的流面：**按上游 `RemoteStream` 的生命周期实现**。
   *
   * 上游的流消费方（`SessionEventStream`、`session/control`）传的是
   * `{ name, open, ended }` 并要求逐帧带 `generation`（换代时据它重发基线）；
   * 我们 `Remote.$stream` 的签名是另一个形状（`args` + 裸帧），转发过去只会拿到空流，
   * 于是 `session/follow` 永远停在 `loading`——事件窗口与投影都收不到帧。
   */
  get $stream(): SessionRemotes["$stream"] {
    return (<Item>(options: RemoteStreamOptions<Item>) =>
      new RemoteStream<Item>(
        { generation: this.connectionOf()?.generation ?? singleGeneration() },
        options,
      )) as SessionRemotes["$stream"];
  }

  /**
   * `session` 面：契约服务有的方法走契约服务（一元结果包成上游要的 `RemoteResult`），
   * 没有的（`follow` / `control` 这类长流）回落到 `Remote.session` namespace。
   */
  get session(): SessionRemotes["session"] {
    const service = this.sessionRemoteOf();
    // target 是空对象：`get` / `has` 全被下面两个陷阱接住，不会被读。
    return new Proxy({} as SessionRemotes["session"], {
      get: (_target, property) => {
        const value: unknown = Reflect.get(service, property);
        if (typeof value === "function") {
          return (...args: never[]): unknown => forwarded(value.apply(service, args));
        }
        const face = this.rawOf("session") ?? {};
        const streamed: unknown = Reflect.get(face, property);
        // 流式方法原样转发：帧（`snapshot` / `event` / `projection`）不能包 `RemoteResult`。
        if (typeof streamed !== "function") return streamed;
        return (...args: never[]): unknown => streamed.apply(face, args);
      },
      has: (_target, property) =>
        Reflect.has(service, property) || Reflect.has(this.rawOf("session") ?? {}, property),
    });
  }

  /**
   * `commands` 面：上游传**整行** `/permission danger-full-access`，我们的 `CommandRunner`
   * 要 `(sessionId, name, input)` 三段——在这一层拆开（首个空格为界）。
   *
   * 结算值必须往下传：上游 `ui-permission-presets` 的 `submit` 只按 `ok` / `matched` 判断，
   * 把处理器的 `{ kind: 'error' }` 吞掉就等于"点了切换、什么都没变"。
   */
  get commands(): SessionRemotes["commands"] {
    const execute = async (
      agentId: Parameters<SessionRemotes["commands"]["execute"]>[0],
      line: string,
    ): Promise<CommandsWireResult> => {
      const text = line.startsWith("/") ? line.slice(1) : line;
      const separator = text.indexOf(" ");
      const name = separator === -1 ? text : text.slice(0, separator);
      const input = separator === -1 ? undefined : text.slice(separator + 1);
      try {
        const executed = await this.commandRunnerOf().run(agentId, name, input);
        // 命令被路由到了（注册表认得这个名字）就是 `matched`——处理器自己的失败走 `ok: false`。
        if (executed.result.kind === "error") {
          return {
            ok: false,
            error: { code: "gateway/invoke-failed", message: executed.result.text },
          };
        }
        return { ok: true, value: { matched: true } };
      } catch (error) {
        const shaped = error as { code?: unknown; message?: unknown };
        return {
          ok: false,
          error: {
            code: typeof shaped.code === "string" ? shaped.code : "gateway/invoke-failed",
            message: typeof shaped.message === "string" ? shaped.message : String(error),
          },
        };
      }
    };
    // 单断言：上游 `RemoteResult` 的失败面是 `RemoteError` 实例（`code` / `message` / `details`），
    // 我们这边是从抛出值折出来的**同形**对象（zephyr-app 的 `failureOf` 也是这么折的）——
    // 上游只读 `ok` / `error.code`，两边的差别只在类型名。
    return { execute } as SessionRemotes["commands"];
  }

  /** `subagents` namespace（走 `Remote`）：每次读成员才解析（`$mount` 之前不读）。 */
  get subagents(): SessionRemotes["subagents"] {
    return new Proxy({} as SessionRemotes["subagents"], {
      get: (_target, property) => {
        const face = this.rawOf("subagents");
        if (face === undefined) {
          throw new Error(
            'remote.subagents is not mounted yet; await whenNamespace("subagents") first',
          );
        }
        const value: unknown = Reflect.get(face, property);
        if (typeof value !== "function") return value;
        return (...args: never[]): unknown => forwarded(value.apply(face, args));
      },
      has: (_target, property) => Reflect.has(this.rawOf("subagents") ?? {}, property),
    });
  }

  /**
   * `Remote` 上的一个 namespace 原始面：`$mount` 之前读不到，给 `undefined`。
   * @param key - `session` / `subagents`。
   * @returns 当前面，或 `undefined`。
   */
  private rawOf(key: "session" | "subagents"): Record<string, unknown> | undefined {
    return namespaceOf(this.remoteOf(), key);
  }
}

/**
 * 把一次一元调用包成上游的 `RemoteResult`。
 *
 * 成功给 `{ ok: true, value }`；失败给 `{ ok: false, error }`，`error` 取抛出值的 `code`/`message`
 * （上游读 `result.error.code` 分流，例如 `workspaceAttachSessionId`）。
 * @param outcome - 调用返回的 Promise 或值。
 * @returns 上游形状的结果。
 */
async function asRemoteResult(
  outcome: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
  try {
    const settled = await outcome;
    // 已经是 `RemoteResult` 就原样返回：测试替身与真机面在这里可能不一致
    // （真机给裸值、部分替身给 `{ok, value}`），包装器对两种都成立。
    if (settled !== null && typeof settled === "object" && "ok" in settled) {
      return settled as
        | { ok: true; value: unknown }
        | { ok: false; error: { code: string; message: string } };
    }
    return { ok: true, value: settled };
  } catch (error) {
    const shaped = error as { code?: unknown; message?: unknown };
    return {
      ok: false,
      error: {
        code: typeof shaped.code === "string" ? shaped.code : "gateway/invoke-failed",
        message: typeof shaped.message === "string" ? shaped.message : String(error),
      },
    };
  }
}
