// 把一组 `@RemoteGroup` / `@Remote` 声明注册到 wire 上。
//
// 声明在类上（组名 + 方法名），注册在这里（一次调用），所以服务端不必手写
// `handlers.register("commands/list", …)` 这种字符串——名字只有一个 home：契约。
import type { RemoteHandlers } from "../api-gateway/remote-handlers.contract.ts";
import {
  remoteGroupNameOf,
  remoteMethodParametersOf,
  remoteMethodsOf,
  remoteStreamMethodsOf,
} from "./decorators.ts";

/** wire 的命名参数 → 方法实参：有 `request` 那一层就剥掉，否则整个 args 就是请求。 */
function requestOf(args: Readonly<Record<string, unknown>>): unknown {
  return (args as { request?: unknown }).request ?? args;
}

/**
 * 注册一个 `@RemoteGroup` 实例的全部方法（unary 走 `register`，`mode: "stream"` 走 `registerStream`）。
 * @param handlers - 宿主侧 handler 表。
 * @param instance - 带 `@RemoteGroup` 的实现实例（方法上标了 `@Remote`）。
 * @returns 撤销注册的函数。
 */
export function registerRemoteGroup(handlers: RemoteHandlers, instance: object): () => void {
  const group = remoteGroupNameOf(instance.constructor);
  if (group === undefined) {
    throw new Error(
      `${instance.constructor.name} 没有 @RemoteGroup：远程注册需要组名（契约上用 { name } 声明）。`,
    );
  }
  const streamMethods = new Set(remoteStreamMethodsOf(instance.constructor));
  const declaredParameters = remoteMethodParametersOf(instance.constructor);
  const disposers = remoteMethodsOf(instance.constructor).map((method) => {
    // 动态成员读：方法名来自运行期元数据，`Reflect.get` 是它的正常入口（不经过类型断言）。
    const handler: unknown = Reflect.get(instance, method);
    if (typeof handler !== "function") {
      throw new Error(`${instance.constructor.name}.${method} 标了 @Remote 但没有实现`);
    }
    // 方法实参：契约上按 `parameters` 声明了命名参数的方法（`upload(agent, request)`、`execute(sessionId, line, …)`）
    // 按声明顺序**逐个取**——descriptor 的位置语义，只有这样它才拿得到整份 args 里的每一项。
    // **声明了就是位置语义，不管几个**：少一处就变成「单参方法收到 args 对象、双参方法收到两个值」这种
    // 两种形状并存（`commands/list` 与 `subagents/interruptByUser` 都踩过）。
    // 没声明 / 声明为空的走 `requestOf`（`{ request }` 剥一层，没有那一层就整个 args 当请求）。
    const names = declaredParameters[method];
    const argsOf = (args: Readonly<Record<string, unknown>>): readonly unknown[] =>
      names !== undefined && names.length > 0 ? names.map((name) => args[name]) : [requestOf(args)];
    const endpoint = `${group}/${method}`;
    if (streamMethods.has(method)) {
      // 流式方法的签名有两种（与上游一致）：`follow(request, signal)` 与 `control(signal)`。
      // 按**实参个数**分派，别一律塞 `(request, signal)`——后者会让 `control` 把请求对象当取消信号，
      // 报 `signal.addEventListener is not a function`。
      // 声明了 `parameters` 的走**位置语义**（与 unary 同一套 `argsOf`）：流式端点也可能是多形参
      // （`workspaceFiles/changes` 的 `(sessionId, path, signal)`、`userQuestions/attachWait` 的
      // `(agentId, callId, signal)`）。只按 `handler.length >= 2` 判会把整份 args 当请求塞进去。
      const declared = names !== undefined && names.length > 0;
      const takesSignalOnly = handler.length <= 1 && !declared;
      return handlers.registerStream(endpoint, (args, signal) =>
        (handler as (...params: unknown[]) => AsyncIterable<unknown>).call(
          instance,
          ...(takesSignalOnly ? [signal] : [...argsOf(args), signal]),
        ),
      );
    }
    return handlers.register(endpoint, async (args) => {
      // unary：实参按 `argsOf` 展开（见上），返回值原样透传（裸值协议）。
      return await (handler as (...params: unknown[]) => Promise<unknown>).call(
        instance,
        ...argsOf(args),
      );
    });
  });
  return () => {
    for (const dispose of disposers) dispose();
  };
}
