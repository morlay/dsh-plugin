// 导入：解析 zip 里的会话日志，落成一个（或整体替换一个）会话。
//
// 解析只认会话格式目录给出的 artifact 名；落库走`SessionHandle`，与写路径同一口径。
import { randomUUID } from "node:crypto";
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionHeader } from "@morlay/dsh-session/contract";
import { parseSessionFormatLogFilename } from "@morlay/dsh-session/contract";
import type { SessionStorageMetadata } from "@morlay/dsh-session-persistence/contract";
import { unzip } from "fflate";
import { balanceRewindPrefix } from "@morlay/better-session/endpoint";
import { restoreCatalog } from "./legacy.ts";

export const SESSION_LOG_ARTIFACT_FILENAME = "session.jsonl";

export const MAX_IMPORT_ZIP_BYTES = 64 * 1024 * 1024;

export function parseJsonlArtifact(content: string): SessionStorageMetadata & {
  events: SessionEvent[];
} {
  const lines = content.split("\n");
  if (lines.length === 0 || lines[0] === "") {
    throw new Error("imported session log is empty");
  }
  let header: unknown;
  try {
    header = JSON.parse(lines[0] as string) as unknown;
  } catch {
    throw new Error("imported session log has an unparsable header line");
  }

  let restore: ReturnType<typeof restoreCatalog.createRestore>;
  try {
    restore = restoreCatalog.createRestore(header, {
      recovery: "strict",
      validation: "transformed",
    });
  } catch (error: unknown) {
    throw new Error(
      `imported session log has an invalid header line: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`imported session log has an unparsable event line at ${i}`);
    }
    try {
      restore.decodeRow(parsed);
    } catch (error: unknown) {
      throw new Error(
        `imported session log has an invalid event line at ${i}: ${error instanceof Error ? error.message : String(error)}`,
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
    throw new Error(
      `imported session log is incomplete: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const meta = artifact.header as SessionHeader;
  const events = artifact.events as SessionEvent[];

  for (let i = 0; i < events.length; i++) {
    if (events[i]!.seq !== i) {
      throw new Error(
        `imported session log seq gap at ${i} (got ${events[i]!.seq}); import requires a dense log`,
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

export async function parseImportZip(
  zip: Uint8Array,
): Promise<SessionStorageMetadata & { events: SessionEvent[] }> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = await unzipAsync(zip);
  } catch {
    throw new Error("imported zip is not a valid ZIP archive");
  }

  const artifact = Object.entries(entries).find(
    ([name]) => parseSessionFormatLogFilename(name) !== undefined,
  );
  if (artifact === undefined) {
    throw new Error(
      `imported zip has no session log artifact (expected ${SESSION_LOG_ARTIFACT_FILENAME} ` +
        "or a canonical session.vN.jsonl)",
    );
  }
  return parseJsonlArtifact(new TextDecoder().decode(artifact[1]));
}

// 落库需要的宿主面：句柄的三个入口、撤回后的 live 失效与 agent 停止。
export interface ImportHost {
  create(header: SessionHeader, inheritedEventCount: number): Promise<ImportHandle>;
  open(id: SessionId, access: "write"): Promise<ImportHandle>;
  readonly writerOf: (id: SessionId) => ImportHandle | undefined;
  rewind(id: SessionId): Promise<void>;
  resetLiveDerivedState(session: unknown): void;
  readonly sessions: { get(id: SessionId): unknown };
  stopLoop(id: SessionId): Promise<void>;
}

// 只声明导入用到的四个成员（`SessionHandle` 的其余面在这里没有调用方）。
export interface ImportHandle {
  append(events: readonly SessionEvent[]): Promise<void>;
  close(): Promise<void>;
}

export async function persistImport(
  host: ImportHost,
  imported: SessionStorageMetadata & { events: SessionEvent[] },
  targetId?: SessionId,
): Promise<SessionId> {
  const id = targetId ?? toSessionId(`session-${randomUUID()}`);
  // 整段导入的日志先配平：已不平衡的尾部会让接收会话的 token-meter 折叠在续写时报 step/end 无配对；
  // 尾部未闭合的 step 是中断运行的正常形状，由上游 resume 补 closers，保持原样。
  const events = balanceRewindPrefix(imported.events, { keepOpenTail: true });
  if (targetId !== undefined) {
    await host.stopLoop(targetId);
    await host.rewind(targetId);

    const liveHandle = host.writerOf(targetId);
    if (liveHandle !== undefined) {
      if (events.length > 0) await liveHandle.append(events);
    } else {
      const handle = await host.open(targetId, "write");
      try {
        if (events.length > 0) await handle.append(events);
      } finally {
        await handle.close();
      }
    }
    const live = host.sessions.get(targetId);
    if (live !== undefined) host.resetLiveDerivedState(live);
    return id;
  }

  const handle = await host.create(
    { ...imported.meta, id },
    Math.min(imported.inheritedEventCount, events.length),
  );
  if (events.length > 0) await handle.append(events);
  await handle.close();
  return id;
}

export async function importZipIntoStore(
  host: ImportHost,
  zip: Uint8Array,
  targetId?: SessionId,
): Promise<SessionId> {
  if (zip.byteLength > MAX_IMPORT_ZIP_BYTES) {
    throw new Error("imported zip exceeds the size limit");
  }
  return await persistImport(host, await parseImportZip(zip), targetId);
}

function toSessionId(id: string): SessionId {
  return SessionId(id);
}
