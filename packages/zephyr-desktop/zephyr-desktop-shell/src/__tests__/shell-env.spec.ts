import { userInfo } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { defaultShellPath, inheritShellEnv, loginShellEnv, parseEnvDump } from "../shell-env.ts";

describe("登录 shell 环境（整份继承）", () => {
  it("解析 env -0（NUL 分隔，值里可以有空格）", () => {
    expect(parseEnvDump("PATH=/usr/bin:/bin\0GREETING=hello world\0EMPTY=\0")).toEqual({
      PATH: "/usr/bin:/bin",
      GREETING: "hello world",
      EMPTY: "",
    });
  });

  it("同名键一律以登录 shell 为准（launchd 那份是系统默认值，不可信）", () => {
    const target: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", SHELL: "/bin/sh" };
    inheritShellEnv(target, { PATH: "/opt/homebrew/bin:/usr/bin:/bin", SHELL: "/bin/zsh" });
    expect(target).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin:/bin", SHELL: "/bin/zsh" });
  });

  it("rc 里 export 的凭证整份继承", () => {
    const target: NodeJS.ProcessEnv = {};
    inheritShellEnv(target, { DEEPSEEK_API_KEY: "sk-xxx" });
    expect(target).toEqual({ DEEPSEEK_API_KEY: "sk-xxx" });
  });

  it("登录 shell 没给出的键保留（壳的部署变量、Electron 注入的键）", () => {
    const target: NodeJS.ProcessEnv = { ZEPHYR_DESKTOP_MODE: "packaged", PATH: "/usr/bin" };
    inheritShellEnv(target, { PATH: "/opt/homebrew/bin" });
    expect(target).toEqual({ ZEPHYR_DESKTOP_MODE: "packaged", PATH: "/opt/homebrew/bin" });
  });

  it("只数真正变了的键（日志按它计数）", () => {
    const target: NodeJS.ProcessEnv = { PATH: "/usr/bin", KEEP: "same" };
    const changed = inheritShellEnv(target, { PATH: "/opt/homebrew/bin", KEEP: "same" });
    expect(changed).toEqual(["PATH"]);
  });

  it("登录 shell 取不到时不报错，也不清空进程环境（尽力而为，不该让壳起不来）", async () => {
    await expect(loginShellEnv("/nonexistent/shell")).resolves.toEqual({});
    const target: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    expect(inheritShellEnv(target, {})).toEqual([]);
    expect(target).toEqual({ PATH: "/usr/bin" });
  });
});

describe("默认 shell", () => {
  it("进程里有 SHELL 就用它", () => {
    vi.stubEnv("SHELL", "/bin/bash");
    expect(defaultShellPath()).toBe("/bin/bash");
    vi.unstubAllEnvs();
  });

  it("GUI 启动没有 SHELL 时回落到账号的登录 shell（否则整段 rc 都不读）", () => {
    vi.stubEnv("SHELL", "");
    const accountShell = userInfo().shell;
    expect(defaultShellPath()).toBe(
      accountShell === null || accountShell === "" ? undefined : accountShell,
    );
    vi.unstubAllEnvs();
  });
});
