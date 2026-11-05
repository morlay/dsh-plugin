// 经 `FileSystem` 令牌的端到端语义：`--` / `r-` / `rw` 三类条目在本包文件围栏上的效果，
// 拒绝一律是 `FS_SANDBOX_DENIED`。真文件系统，拒绝时磁盘上不留改动。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystem } from "@morlay/dsh-fs";
import { ConfigurableFsSandbox, SandboxRulesDefault } from "@morlay/configurable-sandbox";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";
import { FakePolicy } from "./support/fake-policy.ts";
import { FakeSandboxFile } from "./support/fake-sandbox-file.ts";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

interface Dirs {
  readonly workspace: string;
  readonly rw: string;
  readonly ro: string;
  readonly deny: string;
}

async function dirs(): Promise<Dirs> {
  const root = await mkdtemp(join(tmpdir(), "configurable-sandbox-fs-"));
  roots.push(root);
  const workspace = join(root, "ws");
  const rw = join(root, "rw");
  const ro = join(root, "ro");
  const deny = join(root, "deny");
  await Promise.all([workspace, rw, ro, deny].map((dir) => mkdir(dir)));
  return { workspace, rw, ro, deny };
}

async function boot(access: Dirs): Promise<App> {
  FakePolicy.root = access.workspace;
  FakeSandboxFile.text = `access = [${[`rw ${access.rw}`, `r- ${access.ro}`, `-- ${access.deny}`]
    .map((entry) => JSON.stringify(entry))
    .join(", ")}]`;
  const app = await bootstrapApplication({
    providers: [FakeSandboxFile, SandboxRulesDefault, FakePolicy, ConfigurableFsSandbox],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return app;
}

describe("FileSystem 的规则端到端", () => {
  it("`--`：读入口就拒绝（resolve 抛 FS_SANDBOX_DENIED）", async () => {
    const d = await dirs();
    const fs = (await boot(d)).get(FileSystem);

    await expect(fs.resolve(join(d.deny, "secret.txt"))).rejects.toMatchObject({
      code: "FS_SANDBOX_DENIED",
    });
  });

  it("`r-`：读放行，写拒绝（磁盘上的内容不变）", async () => {
    const d = await dirs();
    const path = join(d.ro, "locked.txt");
    await writeFile(path, "original", "utf8");
    const fs = (await boot(d)).get(FileSystem);

    const target = await fs.resolve(path);
    expect(await fs.readText(target)).toBe("original");
    await expect(fs.writeText(target, "changed")).rejects.toMatchObject({
      code: "FS_SANDBOX_DENIED",
    });
    expect(await readFile(path, "utf8")).toBe("original");
  });

  it("`rw`：额外可写根在 workspace-write 下可写", async () => {
    const d = await dirs();
    const fs = (await boot(d)).get(FileSystem);
    const path = join(d.rw, "note.txt");

    await fs.writeText(await fs.resolve(path), "hello");
    expect(await readFile(path, "utf8")).toBe("hello");
  });

  it("工作区基线：workspace-write 下工作区内可写", async () => {
    const d = await dirs();
    const fs = (await boot(d)).get(FileSystem);
    const path = join(d.workspace, "inside.txt");

    await fs.writeText(await fs.resolve(path), "inside");
    expect(await readFile(path, "utf8")).toBe("inside");
  });
});
