// attachment 域的局部闭环：真 `LocalAttachmentStore`，只把 `dshHome` 换成临时目录。
//
// 断言落在契约面最有判别力的一处：同一份字节两次落盘得到同一个内容寻址 id，且读回来逐字节相同。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provideAttachment, AttachmentStore, AttachmentStoreDefault } from "@morlay/dsh-attachment";
import { bootstrapApplication, type App, configure } from "@morlay/zephyr";
import { afterEach, describe, expect, it } from "vitest";

const opened: App[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const app of opened.splice(0)) await app.dispose().catch(() => {});
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}, 20_000);

async function boot(): Promise<{ store: AttachmentStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dsh-attachment-"));
  roots.push(root);
  const app = await bootstrapApplication({
    providers: [...provideAttachment(configure(AttachmentStoreDefault, { dshHome: root }))],
    timeoutMs: 10_000,
  });
  opened.push(app);
  return { store: app.get(AttachmentStore), root };
}

describe("attachment 域", () => {
  it(
    "文件按内容寻址落盘：同样的字节两次得到同一个 id，读回来逐字节相同",
    { timeout: 20_000 },
    async () => {
      const { store, root } = await boot();
      const bytes = new TextEncoder().encode("附件正文\n");

      const first = await store.saveFile({ data: bytes, name: "note.txt" });
      const second = await store.saveFile({ data: bytes, name: "note.txt" });
      expect(first.name).toBe("note.txt");
      expect(first.bytes).toBe(bytes.byteLength);
      expect(second.attachmentId).toBe(first.attachmentId);

      const chunks: Uint8Array[] = [];
      for await (const chunk of store.readFileStream(first)) chunks.push(chunk);
      expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("附件正文\n");

      // 落盘位置在装配面给的 home 之下（不写到用户的真实 `~/.dsh`）。
      expect(store.fileHostPath(first)?.startsWith(root)).toBe(true);
    },
  );
});
