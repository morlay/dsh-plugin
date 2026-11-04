import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { installProfileClosure } from "../cli/electron-builder.ts";

let work: string;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "dsh-profile-closure-"));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

test("把 prepareSeed 的 deploy 闭包原样铺到 Resources/profile（顶层相对链接跟着搬）", async () => {
  const buildCache = join(work, "build");
  const resources = join(work, "Resources");
  const deployed = join(buildCache, "deploy");
  const store = join(deployed, "node_modules", ".pnpm", "pkg@1.0.0", "node_modules", "pkg");
  await mkdir(store, { recursive: true });
  await writeFile(join(store, "index.js"), "export const marker = 1;\n");
  await mkdir(join(deployed, "node_modules"), { recursive: true });
  // `deployClosure` 的 `linkClosureTopLevel` 就是这么挂的：指向 `.pnpm` 的**相对**链接。
  await (
    await import("node:fs/promises")
  ).symlink(
    join(".pnpm", "pkg@1.0.0", "node_modules", "pkg"),
    join(deployed, "node_modules", "pkg"),
  );
  await writeFile(join(deployed, "package.json"), `${JSON.stringify({ name: "app" })}\n`);

  // 旧产物里的 profile（上一次打包留下的）要被整体替换，不能残留。
  await mkdir(join(resources, "profile", "stale"), { recursive: true });

  await installProfileClosure(resources, buildCache);

  const profile = join(resources, "profile");
  expect(await readFile(join(profile, "node_modules", "pkg", "index.js"), "utf8")).toBe(
    "export const marker = 1;\n",
  );
  expect((await readlink(join(profile, "node_modules", "pkg"))).startsWith(".pnpm")).toBe(true);
  await expect(stat(join(profile, "stale"))).rejects.toThrow();
});
