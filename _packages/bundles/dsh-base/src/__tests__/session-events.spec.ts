import type { Events } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import {
  SESSION_CREATED,
  SESSION_DISPOSED,
  SESSION_EVENT,
  SESSION_FLUSH,
} from "../session/session.events.ts";

describe("session 事件符号", () => {
  it("是上游 Events 的键：ctx.on / ctx.emit 直接按上游签名收参数", () => {
    const names: readonly (keyof Events)[] = [
      SESSION_CREATED,
      SESSION_DISPOSED,
      SESSION_EVENT,
      SESSION_FLUSH,
    ];

    expect(names).toEqual(["session/created", "session/disposed", "session/event", "session/flush"]);
  });
});
