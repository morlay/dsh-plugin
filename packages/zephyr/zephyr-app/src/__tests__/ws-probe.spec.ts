import { describe, expect, it } from "vitest";
import { bootstrapApplication } from "@morlay/zephyr";
import { WebServer, WebStartupDefault, WebServerDefault } from "@morlay/zephyr-app/testing";

describe("webserver listen（单 Provider 入口）", () => {
  it("onInit 跑完端口可用", { timeout: 10_000 }, async () => {
    const app = await bootstrapApplication({
      providers: [WebStartupDefault, WebServerDefault],
      timeoutMs: 10_000,
    });
    console.log("port =", app.get(WebServer).port);
    expect(app.get(WebServer).port).toBeGreaterThan(0);
    await app.dispose();
  });
});
