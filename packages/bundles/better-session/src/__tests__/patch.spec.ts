import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORK_SETTINGS_NAMESPACE } from "../../../../session/ui-conversation/src/settings-namespace.ts";

const repoRoot = process.cwd();
const PATCH_PATH = join(repoRoot, "packages/bundles/better-session/cordis.patch.yml");
const BUNDLE_ROOT = join(repoRoot, "vendor/deepseek-harness/packages/bundle");

const patch = await readFile(PATCH_PATH, "utf8");

function disabledIds(text: string): string[] {
  return [...text.matchAll(/^- id: (\S+)\n {2}disabled: true$/gm)].map((match) => match[1]!);
}

function configuredIds(text: string): string[] {
  return [...text.matchAll(/^- id: (\S+)\n {2}config:$/gm)].map((match) => match[1]!);
}

function insertedIds(text: string): string[] {
  const block = text.split(/^- insert:\s*$/m)[1];
  if (block === undefined) return [];
  return [...block.matchAll(/^ {4}- id: (\S+)$/gm)].map((match) => match[1]!);
}

async function bundleIds(file: string): Promise<Set<string>> {
  const text = await readFile(file, "utf8");
  return new Set([...text.matchAll(/^\s*- id: (\S+)$/gm)].map((match) => match[1]!));
}

const upstreamIds = new Set([
  ...(await bundleIds(join(BUNDLE_ROOT, "base/cordis.patch.yml"))),
  ...(await bundleIds(join(BUNDLE_ROOT, "web-app/cordis.patch.yml"))),
]);

describe("better-session patch wiring", () => {
  it("targets upstream bundle rows that still exist", () => {
    const targets = [...disabledIds(patch), ...configuredIds(patch)];
    expect(targets.length).toBeGreaterThan(0);
    for (const id of targets) expect(upstreamIds.has(id), `missing upstream row: ${id}`).toBe(true);
  });

  it("disables exactly the documented official rows", () => {
    expect(disabledIds(patch).sort()).toEqual([
      "session-persistence-jsonl",
      "session-projection-cache",
      "session-query-sqlite",
      "storage-json",
      "ui-conversation",
    ]);
  });

  it("inserts morlay rows without colliding with upstream ids", () => {
    const inserted = insertedIds(patch);
    expect(inserted.sort()).toEqual([
      "reference",
      "session-branch",
      "session-rdb",
      "ui-conversation-fork",
      "ui-conversation-manager",
      "ui-conversation-message-actions",
      "ui-primitives-fork",
    ]);
    for (const id of inserted) expect(upstreamIds.has(id)).toBe(false);
  });

  // fork 客户端按自己的行 id 读写设置；行 id 与命名空间脱节时设置只改内存、重启即丢。
  it("inserts the conversation fork under its settings namespace", () => {
    expect(patch).toMatch(
      new RegExp(
        `^ {4}- id: ${FORK_SETTINGS_NAMESPACE}\n {6}name: "@morlay/dsh-client-ui-conversation"$`,
        "m",
      ),
    );
  });
});
