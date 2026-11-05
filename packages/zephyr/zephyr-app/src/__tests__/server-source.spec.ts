// 服务端 HMR 的**触发面**：哪些文件变了要重载行，哪些不该。
//
// 判据错一边都要命：漏了 → 改动不生效；多算了 → 改个浏览器组件就把整条注入链换掉。
import { isServerSource } from "../vite-handoff/vite-handoff.service.ts";
import { describe, expect, it } from "vitest";

describe("isServerSource", () => {
  it("服务端源码：要重载", () => {
    for (const file of [
      "/repo/packages/agent/dsh-session/src/server/session.provide.ts",
      "/repo/packages/zephyr/zephyr/src/bootstrap.ts",
      "/repo/packages/agent/dsh-agent/src/index.ts",
    ]) {
      expect(isServerSource(file), file).toBe(true);
    }
  });

  it("客户端那半：不重载（vite 自己的 HMR 管）", () => {
    for (const file of [
      "/repo/packages/agent/dsh-session/src/client/index.ts",
      "/repo/packages/agent/dsh-session/src/ui/sessions-binding.ts",
      "/repo/apps/zephyr-custom/src/client/app-boot.ts",
    ]) {
      expect(isServerSource(file), file).toBe(false);
    }
  });

  it("非源码 / 依赖 / 测试：不重载", () => {
    for (const file of [
      "/repo/node_modules/foo/src/index.ts",
      "/repo/packages/agent/dsh-session/src/server/session.spec.ts",
      "/repo/packages/agent/dsh-session/README.md",
      "/repo/packages/agent/dsh-session/src/server/session.css",
    ]) {
      expect(isServerSource(file), file).toBe(false);
    }
  });
});
