/**
 * 会话持久化的闭环：建一份会话、再从**同一份后端**读回来。
 *
 * 判据走契约（`stat` / `list`），不判磁盘上的具体文件名：这一行装的是上游 `session-persistence-jsonl`，
 * 它按 project 分组、把 header 写成日志首行——布局是它的实现细节，我们的契约只承诺"写得进、读得回"。
 *
 * 只假外部能力（`AppEnv` 给临时目录）。
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SessionId } from "@morlay/dsh-session/endpoint";
import { SESSION_FORMAT_VERSION } from "@morlay/dsh-session/server";
import { bootstrapApplication } from "@morlay/zephyr";
import { AppEnv } from "@morlay/zephyr-app";
import { describe, expect, test } from "@morlay/zephyr-app/testing";
import { SessionPersistence } from "../contract/index.ts";
import { provideSessionPersistence } from "../session-persistence.provide.ts";

/** 测试用的运行环境：数据根指向临时目录。 */
/**
 * 递归数一个目录下的文件数（目录不存在算 0）。
 * @param dir - 起始目录。
 * @returns 文件数。
 */
async function countFiles(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    total += entry.isDirectory() ? await countFiles(join(dir, entry.name)) : 1;
  }
  return total;
}

describe("会话持久化", () => {
  test(
    "create 之后 `stat` / `list` 读得回，`flush` 之后盘上真有文件",
    { timeout: 20_000 },
    async ({ appEnv }) => {
      const app = await bootstrapApplication({
        providers: [{ provide: AppEnv, useValue: appEnv }, ...provideSessionPersistence()],
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

        // 读回：`stat` 给这一份的快照，身份在 `header.id`。
        expect((await persistence.stat(id))?.header.id).toBe("spec-session");

        // `list` 回的是快照（`{ header, revision }`），会话身份在 `header.id`。
        const listed = await persistence.list();
        expect(listed.map((entry) => entry.header.id)).toContain("spec-session");

        // 真的落了盘：`flush` 之后 `root` 下至少有一个文件（布局由上游决定，这里只确认"写了东西"）。
        await persistence.flush();
        expect(await countFiles(join(appEnv.values.dataDir, "sessions"))).toBeGreaterThan(0);
      } finally {
        await app.dispose();
      }
    },
  );
});
