// 本机部署不做认证：上游 `admit` 的三种结果里只有「缺认证」（401）这一档该被放行成 owner peer。
// 403 是 Host / Origin 信任检查（它挡的是别的站点借道本机端口），与本机不设认证无关，必须原样保留。
import { describe, expect, test } from "@morlay/zephyr/testing";
import type { Logger } from "@morlay/zephyr";
import { admitLocalPeer } from "../connection.service.ts";

/** 上游发布给浏览器的那份 owner peer（`connection.browserPeer`）。 */
const BROWSER_PEER = { id: "browser-peer" };

/** 上游 `connection` 实例的最小替身：只要 `admit` 与 `browserPeer` 两个面。 */
function instanceOf(admit: (request: unknown) => unknown): {
  admit: (request: unknown) => unknown;
  browserPeer: unknown;
} {
  return { admit, browserPeer: BROWSER_PEER };
}

/** 一条只记 warn 的日志出口。 */
function loggerOf(warnings: string[]): Logger {
  const warn = (format: unknown, ...params: unknown[]): void => {
    warnings.push([format, ...params].map(String).join(" "));
  };
  return { error: () => {}, warn, info: () => {}, debug: () => {} };
}

describe("本机免认证", () => {
  test("缺认证（401）放行成 owner peer", () => {
    const instance = instanceOf(() => ({ rejection: 401 }));
    admitLocalPeer(instance, loggerOf([]));

    expect(instance.admit({ headers: {} })).toEqual({ peer: BROWSER_PEER });
  });

  test("Host / Origin 不信任（403）原样保留", () => {
    const instance = instanceOf(() => ({ rejection: 403 }));
    admitLocalPeer(instance, loggerOf([]));

    expect(instance.admit({ headers: {} })).toEqual({ rejection: 403 });
  });

  test("已认证的凭据返回它自己的 peer，不被换掉", () => {
    const apiPeer = { id: "api-peer" };
    const instance = instanceOf(() => ({ peer: apiPeer }));
    admitLocalPeer(instance, loggerOf([]));

    expect(instance.admit({ headers: {} })).toEqual({ peer: apiPeer });
  });

  test("上游没有 admit / browserPeer 时记一条 warn，不抛也不改实例", () => {
    const warnings: string[] = [];
    const instance = { admit: undefined, browserPeer: undefined };
    admitLocalPeer(instance, loggerOf(warnings));

    expect(warnings, "装配可诊断：拿不到面要留下一条 warn").toHaveLength(1);
    expect(instance.admit).toBeUndefined();
  });
});
