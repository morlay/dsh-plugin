// 自研组的 wire 入口：`has` 的三种状态，以及桥把 `payload.args` 交给路由表后包成 Connection 的结果面。
//
// 不起服务、不装 DI：桥只读 `connection.rpc.intercept` 与 `handlers` 两个面，替身就这两个。
import { describe, expect, it } from "vitest";
import { RemoteHandlersRpcBridge } from "../remote-handlers.rpc-bridge.ts";
import { RemoteHandlersDefault } from "../remote-handlers.service.ts";

/** 注册项上的处理器（末两位是 wire 的取消信号与 peer：本 spec 不读它们）。 */
type CapturedHandler = (
  endpoint: string,
  payload: unknown,
  ...rest: never[]
) => Promise<{ readonly ok: boolean; readonly value?: unknown; readonly error?: unknown }>;

/** 桥注册到 `/api` 上的那一条。 */
interface CapturedInterceptor {
  readonly channel: string;
  readonly matches: (endpoint: string) => boolean;
  readonly handler: CapturedHandler;
}

/**
 * 造一个桥：假 `Connection` 收下 `intercept` 的注册项，用例拿它直接调。
 * @param handlers - 真路由表（`has` / `invoke` 都要真的）。
 * @returns 桥、它注册的那一项、注销次数。
 */
function bridgeOf(handlers: RemoteHandlersDefault): {
  bridge: RemoteHandlersRpcBridge;
  interceptor: CapturedInterceptor;
  disposals: () => number;
} {
  const registered: CapturedInterceptor[] = [];
  let disposed = 0;
  const connection = {
    rpc: {
      intercept: (
        channel: string,
        matches: (endpoint: string) => boolean,
        handler: CapturedHandler,
      ) => {
        registered.push({ channel, matches, handler });
        return async (): Promise<void> => {
          disposed += 1;
        };
      },
    },
  };
  // 桥在 intercept 前后会记行日志（真 Logger 的 info）：替身也要给全——缺它不是"少一条日志"，
  // 而是装配缺陷；夹具补齐，别在实现里对 logger 做可选宽容。
  const logger = { info: (): void => {}, warn: (): void => {} };
  const bridge = new RemoteHandlersRpcBridge();
  Object.assign(bridge, { connection, handlers, logger });
  bridge.onInit();
  const interceptor = registered[0];
  if (interceptor === undefined) throw new Error("桥没有注册 `/api` 的拦截项");
  return { bridge, interceptor, disposals: () => disposed };
}

describe("`RemoteHandlersDefault.has`", () => {
  it("unary / 流式 / 没注册 三种状态", () => {
    const handlers = new RemoteHandlersDefault();
    handlers.register("settings/describe", async () => ({ items: [] }));
    handlers.registerStream("userQuestions/attachWait", async function* () {
      yield { remainingMs: 0 };
    });

    expect(handlers.has("settings/describe"), "unary 注册过就是 true").toBe(true);
    expect(
      handlers.has("userQuestions/attachWait"),
      "流式端点不能算进来：拦截器一次只回一个值",
    ).toBe(false);
    expect(handlers.has("sessionMode/roster"), "没注册就是 false").toBe(false);
  });
});

describe("RemoteHandlersRpcBridge", () => {
  it("认领 `/api` 上已注册为 unary 的端点，流式与没注册的不认领", () => {
    const handlers = new RemoteHandlersDefault();
    handlers.register("sessionMode/roster", async () => ({ modes: [] }));
    handlers.registerStream("userQuestions/attachWait", async function* () {
      yield { remainingMs: 0 };
    });
    const { interceptor } = bridgeOf(handlers);

    expect(interceptor.channel).toBe("/api");
    expect(interceptor.matches("sessionMode/roster")).toBe(true);
    expect(interceptor.matches("userQuestions/attachWait")).toBe(false);
    expect(interceptor.matches("workspace/follow")).toBe(false);
  });

  it("`payload.args` 交给路由表，结果包成 `{ ok: true, value }`", async () => {
    const handlers = new RemoteHandlersDefault();
    const seen: Readonly<Record<string, unknown>>[] = [];
    handlers.register("settings/describe", async (args) => {
      seen.push(args);
      return { items: [{ key: "ui.theme" }] };
    });
    const { interceptor } = bridgeOf(handlers);

    const outcome = await interceptor.handler("settings/describe", { args: { scope: "ui" } });

    expect(seen, "命名参数原样进处理器").toEqual([{ scope: "ui" }]);
    expect(outcome).toEqual({ ok: true, value: { items: [{ key: "ui.theme" }] } });
  });

  it("处理器抛错时回失败面：`code` 取异常上的 code，没有就 `gateway/invoke-failed`", async () => {
    const handlers = new RemoteHandlersDefault();
    handlers.register("settings/write", async () => {
      throw Object.assign(new Error("设置项只读"), {
        code: "settings/read-only",
        details: { key: "ui.theme" },
      });
    });
    handlers.register("settings/reset", async () => {
      throw new Error("磁盘炸了");
    });
    const { interceptor } = bridgeOf(handlers);

    expect(await interceptor.handler("settings/write", { args: {} })).toEqual({
      ok: false,
      error: { code: "settings/read-only", message: "设置项只读", details: { key: "ui.theme" } },
    });
    expect(await interceptor.handler("settings/reset", { args: {} })).toEqual({
      ok: false,
      error: { code: "gateway/invoke-failed", message: "磁盘炸了", details: {} },
    });
  });

  it("卸载时注销拦截项", async () => {
    const { bridge, disposals } = bridgeOf(new RemoteHandlersDefault());

    await bridge.onDispose();

    expect(disposals()).toBe(1);
  });
});
