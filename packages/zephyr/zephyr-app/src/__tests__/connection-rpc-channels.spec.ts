// `shareRpcChannels`：上游一条共享通道只容一个物理拦截器，多个贡献方要按注册顺序共存。
//
// 这条判据只有运行期才看得见：装错了就是第二个注册当场抛（装配期），或者自研端点仍然 404。
import { describe, expect, it } from "vitest";
import { shareRpcChannels } from "../connection/connection.service.ts";
import type { Logger } from "@morlay/zephyr";

/** 静音日志（本 spec 只看注册行为）。 */
const SILENT: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
} as Logger;

type Handler = (
  endpoint: string,
  payload: unknown,
) => Promise<{ readonly ok: boolean; readonly value?: unknown; readonly error?: unknown }>;

/** 一条物理拦截项（上游 `interceptors` 里那份的处理器半边）。 */
interface Physical {
  readonly channel: string;
  readonly matches: (endpoint: string) => boolean;
  readonly handler: Handler;
}

/**
 * 造一个假的上游 `connection`：`intercept` 与上游同口径——同一通道第二次注册直接抛。
 * @returns 实例、它收下的物理拦截项、注销次数。
 */
function connectionOf(): {
  instance: { rpc: unknown };
  physical: Physical[];
  disposals: () => number;
} {
  const physical: Physical[] = [];
  let disposed = 0;
  const instance = {
    rpc: {
      handle: () => async (): Promise<void> => {},
      intercept: (
        channel: string,
        matches: (endpoint: string) => boolean,
        handler: Handler,
      ): (() => Promise<void>) => {
        if (physical.length > 0) {
          throw new Error(
            `connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`,
          );
        }
        physical.push({ channel, matches, handler });
        return async (): Promise<void> => {
          disposed += 1;
          physical.splice(0, physical.length);
        };
      },
    },
  };
  return { instance, physical, disposals: () => disposed };
}

describe("shareRpcChannels", () => {
  it("同一条通道上的第二、第三个注册不再抛，按注册顺序分发", async () => {
    const { instance, physical } = connectionOf();
    shareRpcChannels(instance, SILENT);
    const rpc = instance.rpc as {
      intercept: (
        channel: "/api",
        matches: (endpoint: string) => boolean,
        handler: Handler,
      ) => () => Promise<void>;
    };
    const calls: string[] = [];
    rpc.intercept(
      "/api",
      (endpoint) => endpoint === "settings/describe",
      async (endpoint) => {
        calls.push(`自研:${endpoint}`);
        return { ok: true, value: "自研" };
      },
    );
    rpc.intercept(
      "/api",
      (endpoint) => endpoint.startsWith("session/"),
      async (endpoint) => {
        calls.push(`上游:${endpoint}`);
        return { ok: true, value: "上游" };
      },
    );

    const interceptor = physical[0];
    if (interceptor === undefined) throw new Error("物理拦截器没有装上");
    expect(physical, "物理拦截器只有一条").toHaveLength(1);
    expect(interceptor.matches("settings/describe"), "第一个贡献方认领的范围").toBe(true);
    expect(interceptor.matches("session/list"), "第二个贡献方认领的范围").toBe(true);
    expect(interceptor.matches("no-such/endpoint"), "没人认领").toBe(false);

    await expect(interceptor.handler("settings/describe", { args: {} })).resolves.toEqual({
      ok: true,
      value: "自研",
    });
    await expect(interceptor.handler("session/list", { args: {} })).resolves.toEqual({
      ok: true,
      value: "上游",
    });
    expect(calls, "各走各的处理器").toEqual(["自研:settings/describe", "上游:session/list"]);
  });

  it("认领项全撤之后物理拦截器才注销", async () => {
    const { instance, physical, disposals } = connectionOf();
    shareRpcChannels(instance, SILENT);
    const rpc = instance.rpc as {
      intercept: (
        channel: "/api",
        matches: (endpoint: string) => boolean,
        handler: Handler,
      ) => () => Promise<void>;
    };
    const first = rpc.intercept(
      "/api",
      (endpoint) => endpoint === "a/b",
      async () => ({ ok: true, value: 1 }),
    );
    const second = rpc.intercept(
      "/api",
      (endpoint) => endpoint === "c/d",
      async () => ({ ok: true, value: 2 }),
    );

    await first();
    expect(physical, "还剩一个认领项：物理拦截器不能撤").toHaveLength(1);
    await second();
    expect(physical, "认领项全撤：物理拦截器跟着注销").toHaveLength(0);
    expect(disposals()).toBe(1);
  });

  it("matcher 与 handler 之间认领项被撤：回 `gateway/bad-request` 失败面，不落到 undefined", async () => {
    const { instance, physical } = connectionOf();
    shareRpcChannels(instance, SILENT);
    const rpc = instance.rpc as {
      intercept: (
        channel: "/api",
        matches: (endpoint: string) => boolean,
        handler: Handler,
      ) => () => Promise<void>;
    };
    const dispose = rpc.intercept(
      "/api",
      (endpoint) => endpoint === "a/b",
      async () => ({ ok: true, value: 1 }),
    );
    const interceptor = physical[0];
    if (interceptor === undefined) throw new Error("物理拦截器没有装上");
    await dispose();

    // 认领项撤了，物理拦截器也注销了：这里直接用还握在手上的那份。
    await expect(interceptor.handler("a/b", { args: {} })).resolves.toMatchObject({
      ok: false,
      error: { code: "gateway/bad-request" },
    });
  });
});
