// sandbox 域的局部闭环：真 `LocalSandboxProvider` / `SandboxPolicyService` / `SandboxedFileSystem` /
// `SandboxBashExecutor`，只把「装配给什么模式与根」换成临时目录。
//
// 断言落在两条契约语义上：策略令牌解析出的执行策略真的带着装配面给的模式与根；
// 文件系统令牌由沙箱行兑现，且它按同一个策略读得到工作区内的文件。
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SandboxBashExecutor from "@deepseek-ai/dsh-bash-sandbox";
import SandboxedFileSystem from "@deepseek-ai/dsh-fs-sandbox";
import { SandboxPolicyService } from "../index.ts";
import LocalSandboxProvider from "@deepseek-ai/dsh-sandbox-local";
import { FileSystem } from "@morlay/dsh-fs";
import { Sandbox, provideSandbox } from "../index.ts";
import { SandboxPolicy, SandboxPolicyDefault } from "../index.ts";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { ShellExecutor, provideShell } from "@morlay/dsh-shell";
import { bootstrapApplication, type App, configure } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

async function boot(): Promise<{ app: App; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-sandbox-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideSessionProjection(),
    ...provideShell(), ...provideSandbox(configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root }))],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return { app, root };
}

describe("sandbox 域", () => {
  it("四个行各归其契约令牌：沙箱提供者 / 策略 / 文件系统 / shell 执行器", async () => {
    const { app } = await boot();
    // Service 类的适配行由上游实例自己兑现令牌（`fromCordis` 只做接管与转发）。
    expect(app.get(Sandbox)).toBeInstanceOf(LocalSandboxProvider);
    expect(app.get(SandboxPolicy)).toBeInstanceOf(SandboxPolicyService);
    expect(app.get(FileSystem)).toBeInstanceOf(SandboxedFileSystem);
    expect(app.get(ShellExecutor)).toBeInstanceOf(SandboxBashExecutor);
  });

  it("`resolve` 无会话时给出部署默认模式与装配面给的兜底根", async () => {
    const { app, root } = await boot();
    expect(app.get(SandboxPolicy).resolve()).toMatchObject({
      mode: "workspace-write",
      workspaceRoot: root,
    });
  });

  it("沙箱文件系统读得到工作区内的文件，路径按规范绝对路径给出", { timeout: 20_000 }, async () => {
    const { app, root } = await boot();
    const file = join(root, "note.txt");
    await writeFile(file, "hello\n", "utf8");

    const fs = app.get(FileSystem);
    const target = await fs.resolve(file);
    expect(fs.processPath(target)).toBe(await realpath(file));
  });
});
