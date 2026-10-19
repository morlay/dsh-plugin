/**
 * storage 域的真装配：真 `@deepseek-ai/dsh-storage` hub + 真 json 后端，只在临时目录上落盘。
 *
 * 两条断言分别守住该包的两层契约：
 * - 装配：`provideStorage` 装完，`Storage` 与 `StorageDomain` 两个令牌都解析得到；
 * - 行为：`StorageDomain.open(spec)` 的域数据面**真的持久化**——关掉再开，记录还在。
 *
 * 具体后端不归这个包：这里直接装上游 json 后端（`@deepseek-ai/dsh-storage-json`）当那个
 * 「外部能力」，本仓那份行是 `@morlay/dsh-persistence`，它反过来依赖本包的契约，所以不在这里引。
 *
 * domain spec 里的 schema 是测试数据（消费方声明），用上游的 `defineDomain` + zod 声明器写，
 * 形状由上游校验；被侧重的存储链路全是真的。
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import * as StorageJsonPlugin from "@deepseek-ai/dsh-storage-json";
import { bootstrapApplication, inject, Injectable, type Context, configure } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Storage, StorageDomain, provideStorage } from "../index.ts";

/** 记录形状：`{ text: string }`。 */
interface Note {
  text: string;
}

/** 测试用 domain 声明：用上游自己的声明器（`defineDomain` + zod），形状由它校验。 */
const spec = defineDomain({
  name: "note",
  version: 1,
  tables: { entry: domainTable<"a", Note>(z.object({ text: z.string() })) },
});

/** 上游 json 后端（外部能力）经 `fromCordis` 挂到本包的 `Storage` 契约上。 */
@Injectable()
class JsonBackend extends fromCordis(StorageJsonPlugin) {
  storage = inject(Storage);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { storage: this.storage });
  }
}

const roots: string[] = [];
const apps: { dispose(): Promise<void> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** 起一套真 storage 栈，根目录在临时目录下。 */
async function boot(): Promise<{
  app: Awaited<ReturnType<typeof bootstrapApplication>>;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "dsh-storage-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [
      ...provideStorage(),
      configure(JsonBackend, { root: join(root, "storages") })([JsonBackend]),
    ],
    timeoutMs: 10_000,
  });
  apps.push(app);
  return { app, root };
}

describe("storage 域", () => {
  it("装配后 Storage 与 StorageDomain 都可解析，json 后端已注册", async () => {
    const { app } = await boot();

    const hub = app.get(Storage);
    expect(typeof hub.mount).toBe("function");
    expect(() => hub.backend.get("json")).not.toThrow();

    expect(app.get(StorageDomain)).toBeInstanceOf(StorageDomain);
  });

  it("open 一个域并写入：关掉再开，记录仍在且落在 json 后端目录里", async () => {
    const { app, root } = await boot();
    const storageDomain = app.get(StorageDomain);

    const opened = await storageDomain.open(spec);
    const entries = opened.table("entry");
    await entries.put("a", { text: "第一条" });
    expect(entries.get("a")).toEqual({ text: "第一条" });
    await opened.close();

    // 重新 open：数据来自后端读取，不是内存残留。
    const reopened = await storageDomain.open(spec);
    const reread = reopened.table("entry");
    expect(reread.get("a")).toEqual({ text: "第一条" });
    expect(reread.size).toBe(1);
    await reopened.close();

    // 介质上确实有该 unit 的文件。
    const files = await readdir(join(root, "storages"));
    expect(files.some((file) => file.startsWith("note"))).toBe(true);
  });
});
