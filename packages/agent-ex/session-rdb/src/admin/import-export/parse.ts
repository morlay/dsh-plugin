// 导入的解析面：zip 解包 + 上游会话格式（jsonl artifact）解码成可落库的日志。
//
// 只做解析与校验（不碰库）；落库在 ./index.ts。
import { SESSION_FORMAT_VERSION, SessionLogOffset } from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionHeader } from "@morlay/dsh-session/contract";
import type { SessionStorageMetadata } from "@morlay/dsh-session-persistence/contract";
import { parseSessionFormatLogFilename } from "@morlay/dsh-session/contract";
import { unzip } from "fflate";
import { SessionStoreError, type SessionStoreFailure } from "../../data/errors.ts";
import { restoreCatalog } from "../../data/store/read-view/legacy.ts";

export const SESSION_LOG_ARTIFACT_FILENAME = "session.jsonl";

export const MAX_IMPORT_ZIP_BYTES = 64 * 1024 * 1024;

// 解压后的总字节上限：zip 可以在几十 KB 里塞进几个 GB，只按压缩包大小挡不住。
export const MAX_IMPORT_UNZIPPED_BYTES = 256 * 1024 * 1024;

// 导入失败的稳定原因取会话域的域码表（`rdb/errors.ts`）：端点按 code 分派文案，客户端不解析文案。
export class SessionImportError extends SessionStoreError {
  constructor(message: string, code: SessionStoreFailure) {
    super(code, message);
    this.name = "SessionImportError";
  }
}

export function parseJsonlArtifact(content: string): SessionStorageMetadata & {
  events: SessionEvent[];
} {
  const lines = content.split("\n");
  if (lines.length === 0 || lines[0] === "") {
    throw new SessionImportError("imported session log is empty", "SESSION_IMPORT_MALFORMED_LOG");
  }
  let header: unknown;
  try {
    header = JSON.parse(lines[0] as string) as unknown;
  } catch {
    throw new SessionImportError(
      "imported session log has an unparsable header line",
      "SESSION_IMPORT_MALFORMED_LOG",
    );
  }

  let restore: ReturnType<typeof restoreCatalog.createRestore>;
  try {
    restore = restoreCatalog.createRestore(header, {
      recovery: "strict",
      validation: "transformed",
    });
  } catch (error: unknown) {
    throw new SessionImportError(
      `imported session log has an invalid header line: ${error instanceof Error ? error.message : String(error)}`,
      "SESSION_IMPORT_MALFORMED_LOG",
    );
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new SessionImportError(
        `imported session log has an unparsable event line at ${i}`,
        "SESSION_IMPORT_MALFORMED_LOG",
      );
    }
    try {
      restore.decodeRow(parsed);
    } catch (error: unknown) {
      throw new SessionImportError(
        `imported session log has an invalid event line at ${i}: ${error instanceof Error ? error.message : String(error)}`,
        "SESSION_IMPORT_MALFORMED_LOG",
      );
    }
  }
  let artifact: { header: unknown; inheritedEventCount: number; events: readonly unknown[] };
  try {
    artifact = restore.finish() as unknown as {
      header: unknown;
      inheritedEventCount: number;
      events: readonly unknown[];
    };
  } catch (error: unknown) {
    throw new SessionImportError(
      `imported session log is incomplete: ${error instanceof Error ? error.message : String(error)}`,
      "SESSION_IMPORT_INCOMPLETE",
    );
  }
  const meta = artifact.header as SessionHeader;
  const events = artifact.events as SessionEvent[];

  for (let i = 0; i < events.length; i++) {
    if (events[i]!.seq !== i) {
      throw new SessionImportError(
        `imported session log seq gap at ${i} (got ${events[i]!.seq}); import requires a dense log`,
        "SESSION_IMPORT_MALFORMED_LOG",
      );
    }
  }

  const inheritedEventCount = Math.min(artifact.inheritedEventCount, events.length);
  return {
    meta: {
      version: SESSION_FORMAT_VERSION,
      id: meta.id,
      createdAt: meta.createdAt,
      ...(meta.cwd === undefined ? {} : { cwd: meta.cwd }),
      ...(meta.parentSession === undefined ? {} : { parentSession: meta.parentSession }),
      isSeeded: meta.isSeeded,
      ...(meta.origin === undefined ? {} : { origin: meta.origin }),
      ...(meta.delegationDepth === undefined ? {} : { delegationDepth: meta.delegationDepth }),
      ...(meta.agentPreset === undefined ? {} : { agentPreset: meta.agentPreset }),
    },
    inheritedEventCount: SessionLogOffset(inheritedEventCount),
    events,
  };
}

// fflate 的 `unzip` 是回调式异步 API（node 侧内部走 worker_threads，浏览器侧走 Web Worker），
// 这里桥成 Promise。
function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, entries) => {
      if (error === null) resolve(entries);
      else reject(error);
    });
  });
}

/**
 * 解析一份导入 zip：解包、认 artifact、解码成可落库的日志。
 *
 * 单条的字节上限在这里判（解压之前）：超限的包直接带码拒绝，不先分配几十 MB。
 * @param zip - 导入包。
 * @returns 可落库的日志与包里那份 artifact 的文件名（上游 format 的 `session.vN.jsonl`）。
 */
export async function parseImportZip(
  zip: Uint8Array,
): Promise<SessionStorageMetadata & { events: SessionEvent[]; filename: string }> {
  if (zip.byteLength > MAX_IMPORT_ZIP_BYTES) {
    throw new SessionImportError("imported zip exceeds the size limit", "SESSION_IMPORT_TOO_LARGE");
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = await unzipAsync(zip);
  } catch {
    throw new SessionImportError(
      "imported zip is not a valid ZIP archive",
      "SESSION_IMPORT_INVALID_PACKAGE",
    );
  }
  const unzipped = Object.values(entries).reduce((total, entry) => total + entry.byteLength, 0);
  if (unzipped > MAX_IMPORT_UNZIPPED_BYTES) {
    throw new SessionImportError(
      "imported zip expands beyond the size limit",
      "SESSION_IMPORT_TOO_LARGE",
    );
  }

  const artifact = Object.entries(entries).find(
    ([name]) => parseSessionFormatLogFilename(name) !== undefined,
  );
  if (artifact === undefined) {
    throw new SessionImportError(
      `imported zip has no session log artifact (expected ${SESSION_LOG_ARTIFACT_FILENAME} ` +
        "or a canonical session.vN.jsonl)",
      "SESSION_IMPORT_NO_ARTIFACT",
    );
  }
  return {
    ...parseJsonlArtifact(new TextDecoder().decode(artifact[1])),
    filename: artifact[0],
  };
}
