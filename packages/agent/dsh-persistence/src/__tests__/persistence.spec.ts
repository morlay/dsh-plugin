// json 后端行的局部闭环：装配面给了 root → 后端以 `json` 这个名字挂到 `Storage` hub 上，
// 记录真的落成 `<root>/demo.json`，换一个应用再装一次还能读回来。
//
// 没有假件：被测的就是本包这份行（`StorageJsonDefault`）+ 上游 json 后端；hub 用本仓的
// `StorageDefault`（同一个上游 `Storage`）。契约是 `@morlay/dsh-storage` 的 `Storage`，
// 这里不另造一份。
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage, StorageDefault } from "@morlay/dsh-storage";
import { providePersistence, StorageJsonDefault } from "@morlay/dsh-persistence";
import { bootstrapApplication, type App, configure } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

/** 一个最小 unit：一张表、没有 global 槽。 */
const DEMO = { name: "demo", version: 1, tables: ["items"], hasGlobal: false } as const;

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dsh-persistence-"));
  roots.push(root);
  return root;
}

/** 起一个只装 hub + json 后端的应用（root 由装配面显式给）。 */
async function boot(root: string): Promise<App> {
  const app = await bootstrapApplication({
    providers: [StorageDefault, ...providePersistence(configure(StorageJsonDefault, { root: root }))],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return app;
}

/** 从 hub 上取 json 后端的 kv 面；后端行没挂上就直接失败，不用可选链吞掉。 */
function kvOf(app: App): NonNullable<ReturnType<Storage["backend"]["get"]>["kv"]> {
  const kv = app.get(Storage).backend.get("json").kv;
  if (kv === undefined) throw new Error("json 后端必须提供 kv facet");
  return kv;
}

describe("persistence：json 后端那一行", () => {
  it("以 `json` 名字挂到 hub 上，写进去的记录落在装配面给的 root 里", async () => {
    const root = await freshRoot();
    const kv = kvOf(await boot(root));
    const unit = await kv.open(DEMO);
    await unit.putRecord("items", "a", { hello: "world" });

    const text = await readFile(join(root, "demo.json"), "utf8");
    expect(JSON.parse(text)).toEqual({
      unit: { name: "demo", version: 1 },
      global: null,
      tables: { items: { a: { hello: "world" } } },
    });
  });

  it("换一个应用、同一个 root：记录读得回来", async () => {
    const root = await freshRoot();
    const first = await boot(root);
    await (await kvOf(first).open(DEMO)).putRecord("items", "a", { hello: "world" });
    await first.dispose();

    const snapshot = await (await kvOf(await boot(root)).open(DEMO)).loadAll();
    expect(snapshot.tables.items).toEqual({ a: { hello: "world" } });
  });
});
