// 包入口迁到 zephyr Provider + `toCordis()` 之后的接缝：dsh 行 id、Config 解析后的 volatile 引用、
// 默认导出的插件形状、上游 `sandboxPolicy` 的令牌注入，以及装载后对 `ctx.sandbox` / `ctx.fs` 的替换行为。
// 行 id 是设置页 namespace 与 locale 的键，Config 的 volatile 引用是「改完当场生效」的前提，两者都不能变。

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVolatile, isVolatile, updateVolatile } from "@deepseek-ai/cosmokit";
import { Context } from "@deepseek-ai/cordis";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import entry, { Config, name } from "../index.ts";

function providePolicy(ctx: Context, policy: object): void {
  Object.setPrototypeOf(policy, SandboxPolicyService.prototype);
  ctx.provide("sandboxPolicy", policy);
}

const contexts: Context[] = [];
let root: string;
let workspace: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "sandbox-local-entry-")));
  workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  await rm(root, { recursive: true, force: true });
});

function newContext(): Context {
  const ctx = new Context();
  contexts.push(ctx);
  providePolicy(ctx, {
    defaultMode: "workspace-write",
    workspaceRoot: workspace,
    resolve: (): SandboxExecutionPolicy => ({ mode: "workspace-write", workspaceRoot: workspace }),
    overrideOf: () => undefined,
  } as never);
  return ctx;
}

describe("包入口（dsh 行）", () => {
  it("行 id 仍是 sandbox-local：default export、命名导出与 rows 装配数据三处一致", () => {
    expect(entry.name).toBe("sandbox-local");
    expect(name).toBe("sandbox-local");
    // zephyr 改走令牌注入：行入口对象上没有 Loader 的字符串 inject 数组。
    expect(entry.inject).toBeUndefined();
    expect("inject" in entry).toBe(false);

    expect(entry.name).toBe("sandbox-local");
  });

  it("default export 带 Config / apply，且与命名导出是同一份事实（Loader 取 default）", () => {
    expect(entry.Config).toBe(Config);
    expect(typeof entry.apply).toBe("function");
    expect(entry.name).toBe(name);
    expect("inject" in entry).toBe(false);
  });
});

describe("上游 sandboxPolicy 的令牌注入", () => {
  it("依赖经 SandboxPolicy 令牌从行 ctx 注入；运行时快照用的就是注入的那份服务", async () => {
    expect(SandboxPolicyService.name).toBe("SandboxPolicyService");

    const ctx = newContext();
    const resolve = vi
      .spyOn(ctx.sandboxPolicy, "resolve")
      .mockReturnValue({ mode: "workspace-write", workspaceRoot: "/injected-root" });
    await ctx.plugin(entry, { cwd: workspace });

    // `installRuntimeContexts` 在 `agent/created` 上给每个 agent 注册 `sandbox:policy`；取出注册的
    // 文本回调喂一个最小 agent，验证它经 `SandboxLocal.policy` 调到了行 ctx 上的上游服务。
    interface CapturedContext {
      readonly name: string;
      readonly text: (context: { readonly agent?: unknown }) => string;
    }
    const registered: CapturedContext[] = [];
    const prompt = {
      getContextOrder: () => 0,
      context: (context: CapturedContext) => {
        registered.push(context);
      },
    };
    const session = { id: "session-1" };
    const agent = {
      session,
      ctx: { get: (service: string) => (service === "systemPrompt" ? prompt : undefined) },
    };

    await ctx.parallel("agent/created", { agent } as never);

    const sandbox = registered.find((context) => context.name === "sandbox:policy");
    expect(sandbox?.text({ agent })).toContain('"/injected-root"');
    expect(resolve).toHaveBeenCalledWith({ session });
  });
});

describe("Config 解析后的 access", () => {
  it("解析后是 volatile 引用：Provider 现场读，改值后下一次判定就用新规则（不重挂这一行）", async () => {
    const resolved = Config({ cwd: workspace, access: ["-- notes.md"] });
    expect(isVolatile(resolved.access)).toBe(true);

    await writeFile(join(workspace, "notes.md"), "hi");
    const ctx = newContext();
    // 行挂载接缝：cordis 已用 Config 解析过行配置，apply 收到的是同一份 ResolvedConfig（引用不换新）。
    const dispose = await entry.apply(ctx, resolved);

    await expect(ctx.fs.resolve("notes.md", { cwd: workspace })).rejects.toMatchObject({
      code: "FS_SANDBOX_DENIED",
    });

    updateVolatile(resolved.access, createVolatile([]));

    await expect(ctx.fs.resolve("notes.md", { cwd: workspace })).resolves.toBeDefined();
    await dispose();
  });
});

describe("default export 装载后的替换行为", () => {
  it("仍替换 ctx.sandbox 与 ctx.fs：deny 在 resolve 入口拒绝，未命中的目标照常读写", async () => {
    const ctx = newContext();
    // dsh Loader 取 default export；cordis 的 fiber 用它的 Config 解析行配置后再 apply。
    await ctx.plugin(entry, { cwd: workspace, access: ["-- mise.*.toml"] });
    await writeFile(join(workspace, "mise.local.toml"), "TOKEN=1");
    await writeFile(join(workspace, "notes.md"), "hi");

    expect(typeof ctx.sandbox.confine).toBe("function");
    expect(ctx.fs.sandboxMode).toBe("workspace-write");
    await expect(ctx.fs.resolve("mise.local.toml", { cwd: workspace })).rejects.toMatchObject({
      code: "FS_SANDBOX_DENIED",
    });

    const notes = await ctx.fs.resolve("notes.md", { cwd: workspace });
    expect(await ctx.fs.readText(notes)).toBe("hi");
  });
});
