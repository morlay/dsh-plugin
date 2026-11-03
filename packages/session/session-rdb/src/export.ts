import { strToU8, zip } from "fflate";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SessionPersistenceRdb } from "./index.ts";
import { SESSION_EXPORT_PATH } from "./routes.ts";
import { mountRoute } from "./http/route.ts";

export { SESSION_EXPORT_PATH };

// 文件名只保留安全字符：会话 id 来自请求体，会写进 Content-Disposition。
function safeFilename(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/gu, "_");
}

// fflate 只给回调式异步 API（同步变体被 node/no-sync 禁止）。
function zipBytes(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error === null) resolve(data);
      else reject(error);
    });
  });
}

// 导出通道：直接把会话日志打成 zip 响应体，与导入通道读同一份 artifact。
export function registerSessionExport(ctx: Context, persistence: SessionPersistenceRdb): void {
  mountRoute(ctx, SESSION_EXPORT_PATH, async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let envelope: { sessionId?: unknown };
    try {
      envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { sessionId?: unknown };
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "request body is not JSON" }));
      return;
    }
    if (typeof envelope.sessionId !== "string" || envelope.sessionId === "") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing sessionId field" }));
      return;
    }
    const sessionId = envelope.sessionId;
    const raw = await persistence.readRaw(sessionId as SessionId);
    if (raw === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `session "${sessionId}" not found` }));
      return;
    }
    const zipFile = await zipBytes({ [raw.filename]: strToU8(raw.content) });
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(zipFile.byteLength),
      "content-disposition": `attachment; filename="${safeFilename(sessionId)}.zip"`,
    });
    res.end(Buffer.from(zipFile));
  });
}
