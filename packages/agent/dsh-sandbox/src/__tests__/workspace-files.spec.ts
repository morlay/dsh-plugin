// `remote.workspaceFiles` 的宿主面：真 `FsSandbox` + 真沙箱策略，读/列都走真文件系统。
//
// 判据：`workspaceFiles/list` 列出临时目录里的真文件名；`workspaceFiles/read` 读回真内容。
// 只假两件外部东西：会话存储（给一条 header.cwd 指向临时目录的会话）与 AppEnv（路径指向临时目录）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsSandbox, SandboxPolicyDefault } from "../index.ts";
import { SessionStore, SessionStoreDefault } from "@morlay/dsh-session";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { provideSessionProjection } from "@morlay/dsh-session/server";
import { SessionPersistenceDefault } from "@morlay/dsh-session-persistence";
import { bootstrapApplication, Injectable, type App, configure } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { RemoteHandlersDefault, provideTypert } from "@morlay/zephyr-app";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceFilesDefault } from "../workspace-files.service.ts";

const SESSION = "s1";

/** `AppEnv` 替身：路径全部指向本用例的临时目录（持久化落在这里）。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  /** 本用例的临时根目录（测试在 `bootstrapApplication` 之前设置）。 */
  static root = "";

  readonly values: AppEnvValues = {
    dataDir: FakeAppEnv.root,
    profileDir: FakeAppEnv.root,
    dev: false,
    aggregate: [],
  };

  readonly cacheDir = join(FakeAppEnv.root, "cache");

  readonly packageRoot = FakeAppEnv.root;

  readonly appBootDir = join(FakeAppEnv.root, "boot");

  readonly profileManifest = join(FakeAppEnv.root, "package.json");
}

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

/** wire 回的 `RemoteResult`：按判别式收窄，不靠断言。 */
function okValueOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("ok" in value) || value.ok !== true) return undefined;
  if (!("value" in value) || typeof value.value !== "object" || value.value === null) return undefined;
  return value.value as Record<string, unknown>;
}

/** 起真文件系统栈 + `workspaceFiles` 行；返回 handler 表与临时根。 */
async function boot(): Promise<{ handlers: RemoteHandlers; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-workspace-files-"));
  roots.push(root);
  FakeAppEnv.root = root;
  await writeFile(join(root, "a.txt"), "第一行\n第二行\n", "utf8");
  await writeFile(join(root, "b.md"), "# b\n", "utf8");
  const app = await bootstrapApplication({
    providers: [...provideTypert(), ...provideSessionProjection(),
    
      FakeAppEnv,
      SessionPersistenceDefault,
      configure(SandboxPolicyDefault, { mode: "workspace-write", workspaceRoot: root })([SandboxPolicyDefault]),
      FsSandbox,
      // 真会话存储：会话的 header.cwd 指向这次用例的目录，作用域解析把它当 workspace 根。
      SessionStoreDefault,
      RemoteHandlersDefault,
      WorkspaceFilesDefault,
    ],
    timeoutMs: 20_000,
  });
  opened.push(app);
  // 一条真会话：header.cwd 就是这次用例的临时根（`prepare` 不发布，`enter` + `announce` 才进表）。
  const sessions = app.get(SessionStore);
  const session = sessions.prepare(SessionId(SESSION), { meta: { cwd: root } });
  sessions.enter(session);
  sessions.announce(session);
  return { handlers: app.get(RemoteHandlers), root };
}

describe("workspaceFiles 的宿主面", { timeout: 30_000 }, () => {
  it("list 列出临时目录里的真文件名", async () => {
    const { handlers, root } = await boot();
    // 上游 `list` 要求**非空** path（`workspace-files/src/index.ts:391`）；列 workspace 根就传绝对根路径，
    // 响应里的 `path` 是 workspace 相对路径（根即空串）。
    const value = okValueOf(
      await handlers.invoke("workspaceFiles/list", { workspaceFileScope: SESSION, path: root }),
    );
    expect(value, `list 失败：${JSON.stringify(value)}`).toBeDefined();
    const entries = value?.entries as readonly { name?: string; type?: string }[] | undefined;
    expect(entries?.map((entry) => entry.name)?.sort()).toEqual(["a.txt", "b.md"]);
    expect(entries?.every((entry) => entry.type === "file")).toBe(true);
    expect(value?.path).toEqual("");
    expect(root).not.toEqual("");
  });

  it("read 读回文件真内容（带行窗口）", async () => {
    const { handlers } = await boot();
    const value = okValueOf(
      await handlers.invoke("workspaceFiles/read", {
        workspaceFileScope: SESSION,
        path: "a.txt",
        range: {},
      }),
    );
    expect(value, `read 失败：${JSON.stringify(value)}`).toBeDefined();
    // 页是按行拼的（不含文件末尾那个换行，与上游 `cutPage` 一致）。
    expect(value?.text).toEqual("第一行\n第二行");
    expect(value?.eof).toBe(true);
  });
});
