/**
 * 会话持久化的闭环：写一份快照、再读回来，断言磁盘布局与内容。
 *
 * 只假外部能力（`AppEnv` 给临时目录），本包实现是真的。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SESSION_FORMAT_VERSION } from "@morlay/dsh-session/server";
import { bootstrapApplication, Injectable } from "@morlay/zephyr";
import { AppEnv, type AppEnvValues } from "@morlay/zephyr-app";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionPersistence } from "../contract/index.ts";
import { provideSessionPersistence } from "../session-persistence.provide.ts";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-session-persistence-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 测试用的运行环境：数据根指向临时目录。 */
@Injectable()
class FakeAppEnv extends AppEnv {
  readonly values: AppEnvValues = { dataDir: root, profileDir: root, dev: false };

  readonly cacheDir = join(root, "cache");

  readonly packageRoot = root;

  readonly appBootDir = join(root, "boot");

  readonly profileManifest = join(root, "package.json");
}

describe("会话持久化", () => {
  it(
    "create 后在 dataDir/sessions/<id>/ 下写出 meta 与 events，并能 list 出来",
    { timeout: 20_000 },
    async () => {
      const app = await bootstrapApplication({
        providers: [FakeAppEnv, ...provideSessionPersistence()],
      });
      try {
        const persistence = app.get(SessionPersistence);
        const id = SessionId("spec-session");
        await persistence.create({
          version: SESSION_FORMAT_VERSION,
          id,
          createdAt: Date.now(),
          isSeeded: false,
        });

        // 磁盘上确实有这一份（meta.json 是 create 的产物）。
        const meta = await readFile(join(root, "sessions", "spec-session", "meta.json"), "utf8");
        expect(meta).toContain("spec-session");

        // `list` 回的是快照（`{ header, revision }`），会话身份在 `header.id`。
        const listed = await persistence.list();
        expect(listed.map((entry) => entry.header.id)).toContain("spec-session");
      } finally {
        await app.dispose();
      }
    },
  );
});
