// working-directory 域的局部闭环：真 `WorkingDirectoryService` + 真投影注册表 + 真本地 fs，
// 只把「会话」换成最小的会话形状（外部域对象，不是本包服务）。
//
// 断言落在两条契约语义上：`get` 读会话已提交的目录、没有记录时回落到部署默认；
// 部署默认必须是绝对路径（上游在构造期就拒绝相对路径，不留到第一次调用）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory";
import { SystemPromptDefault } from "@morlay/dsh-agent/server";
import { SessionStore, SessionStoreDefault } from "@morlay/dsh-session";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { FileSystem } from "@morlay/dsh-fs";
import { WorkingDirectory, provideWorkingDirectory, WorkingDirectoryDefault } from "../index.ts";
import { bootstrapApplication, Injectable, type App, type Context, configure } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { afterEach, describe, expect, it } from "vitest";

/** 测试内的 fs：上游本地文件系统经 `fromCordis` 接管到本仓契约令牌。 */
@Injectable()
class LocalFs extends fromCordis(FileSystem, LocalFileSystem) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

async function boot(): Promise<{ app: App; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-working-directory-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideSessionProjection(),
    
      LocalFs,
      SystemPromptDefault,
      SessionStoreDefault,
      ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: root })),
    ],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return { app, root };
}

describe("working-directory 域", () => {
  it("`provideWorkingDirectory` 装的是上游实现，契约令牌能解析", async () => {
    const { app } = await boot();
    // Service 类的适配行由上游实例自己兑现令牌（`fromCordis` 只做接管与转发）。
    expect(app.get(WorkingDirectory)).toBeInstanceOf(WorkingDirectoryService);
  });

  it("`get` 读会话已提交的目录；没有记录时回落到部署默认", async () => {
    const { app, root } = await boot();
    const workingDirectory = app.get(WorkingDirectory);

    const store = app.get(SessionStore);
    const project = join(root, "project");
    // 会话身份由存储铸出（不需要造 `Session` 形状）：`meta.cwd` 就是「已提交的目录」。
    expect(workingDirectory.get(store.create(undefined, { meta: { cwd: project } }))).toBe(project);
    expect(workingDirectory.get(store.create())).toBe(root);
  });

  it("部署默认必须是绝对路径：相对路径在装配期就失败", async () => {
    await expect(
      bootstrapApplication({
        providers: [...provideSessionProjection(),
        
          LocalFs,
          SystemPromptDefault,
          ...provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory: "relative/dir" })),
        ],
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow(/defaultDirectory must be absolute/);
  });
});
