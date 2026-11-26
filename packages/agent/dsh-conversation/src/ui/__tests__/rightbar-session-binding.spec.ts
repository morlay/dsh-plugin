// `SessionBinding` 的配对判据：retain / release 的次数与顺序（切换时先释放再 retain）。
//
// 也守「字段初始化时 inject 还是占位符」那个 bug：构造入参是**取实例的 thunk**，不是在构造期存实例。
import { describe, expect, test, vi } from "vitest";
import { SessionBinding } from "../shell/rightbar-session-binding.ts";

/**
 * 造一个记录调用的 `sessions`。
 * @returns `sessions` 与调用序列。
 */
function sessionsOf() {
  const calls: string[] = [];
  const sessions = {
    retain: vi.fn((sessionId: string) => {
      calls.push("retain:" + sessionId);
      return {
        sessionId,
        release: () => {
          calls.push("release:" + sessionId);
        },
      };
    }),
  };
  return { sessions: () => sessions, calls };
}

describe("SessionBinding（retain / release 配对）", () => {
  test("undefined 到 s1：retain s1 一次", () => {
    const { sessions, calls } = sessionsOf();
    const binding = new SessionBinding(sessions as never);
    binding.select("s1");
    expect(calls).toEqual(["retain:s1"]);
    expect(binding.sessionId).toBe("s1");
  });

  test("s1 到 s2：先 release s1、再 retain s2（顺序不许反）", () => {
    const { sessions, calls } = sessionsOf();
    const binding = new SessionBinding(sessions as never);
    binding.select("s1");
    binding.select("s2");
    expect(calls).toEqual(["retain:s1", "release:s1", "retain:s2"]);
    expect(binding.sessionId).toBe("s2");
  });

  test("s2 到 undefined：release s2 一次", () => {
    const { sessions, calls } = sessionsOf();
    const binding = new SessionBinding(sessions as never);
    binding.select("s2");
    binding.select(undefined);
    expect(calls).toEqual(["retain:s2", "release:s2"]);
    expect(binding.sessionId).toBeUndefined();
    expect(binding.reference).toBeUndefined();
  });

  test("同一会话重复 select 不再 retain（幂等）", () => {
    const { sessions, calls } = sessionsOf();
    const binding = new SessionBinding(sessions as never);
    binding.select("s1");
    binding.select("s1");
    expect(calls).toEqual(["retain:s1"]);
  });
});
