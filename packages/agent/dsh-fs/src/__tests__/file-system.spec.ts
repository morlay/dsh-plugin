// `FileSystem` 契约的局部闭环：契约面能被一个**真的**上游后端兑现。
//
// 本包没有自己的实现（实现是沙箱域那条行），所以这里用上游 `@deepseek-ai/dsh-fs-local` 当兑现方：
// 它没有沙箱耦合，能在测试里直接 mount。断言走契约声明的四个成员（`resolve` / `processPath` /
// `fileUrl` / `watch` 的类型面），证明契约的投影面既够窄、又真的有人能满足。
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { FileSystem } from "../contract/index.ts";
import { bootstrapApplication, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";

/** 测试内的兑现方：上游本地文件系统经 `fromCordis` 接管到本包的契约令牌。 */
@Injectable()
class LocalFs extends fromCordis(FileSystem, LocalFileSystem) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

async function boot(): Promise<FileSystem> {
  const app = await bootstrapApplication({ providers: [LocalFs], timeoutMs: 10_000 });
  onTestFinished(() => app.dispose().catch(() => {}));
  return app.get(FileSystem);
}

describe("FileSystem 契约：上游后端真能兑现", () => {
  test("`resolve` 给出规范路径，`processPath` / `fileUrl` 与它一致", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-fs-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const file = join(root, "note.txt");
    await writeFile(file, "hello\n", "utf8");

    const fs = await boot();
    const target = await fs.resolve(file);
    expect(fs.processPath(target)).toBe(await realpath(file));
    expect(fs.fileUrl(target)).toBe(new URL(`file://${await realpath(file)}`).href);
  });

  test("`watch` 是契约面的一部分：对还不存在的目标能开出一条观察，并能关掉", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-fs-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const absent = join(root, "absent.txt");

    const fs = await boot();
    const target = await fs.resolve(absent);
    const watcher = await fs.watch(target, () => {}, new AbortController().signal);
    await expect(watcher()).resolves.toBeUndefined();
  });
});
