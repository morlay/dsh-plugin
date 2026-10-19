// 导入通道的纯逻辑：解析 artifact、按目标写入（是否覆盖已有会话由调用方决定）。
import { randomUUID } from "node:crypto";
import { SESSION_FORMAT_VERSION, SessionLogOffset } from "@deepseek-ai/dsh-session";
import type { Session, SessionEvent, SessionId, SessionHeader } from "@deepseek-ai/dsh-session";
import { parseSessionFormatLogFilename } from "@deepseek-ai/dsh-session-format";
import type { SessionStorageMetadata } from "@deepseek-ai/dsh-session-persistence";
import { balanceRewindPrefix } from "../branch/balance.ts";
import { unzip } from "fflate";
import { replaceLiveSessionLog } from "../branch.ts";
import { restoreCatalog } from "../legacy.ts";
import type { SessionPersistenceRdb } from "../persistence/session-persistence-rdb.service.ts";

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
// 这里桥成 Promise。它与 `unzipSync` 的差异只在同步/异步：非法 zip 走的是同一段校验代码，
// 拒绝的错误对象与同步版一致，因此上层文案无需区分。
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

export async function persistImport(
  persistence: SessionPersistenceRdb,
  branch:
    | {
        rewind(id: SessionId, toBoundary: number): Promise<unknown>;

        resetLiveDerivedState?(session: Session): void;
      }
    | undefined,
  imported: SessionStorageMetadata & { events: SessionEvent[] },
  targetId?: SessionId,
  sessions?: { get(id: SessionId): Session | undefined },
  stopLoop?: (id: SessionId) => Promise<void>,
): Promise<SessionId> {
  const id = targetId ?? (`session-${randomUUID()}` as SessionId);
  // 整段导入的日志先配平：已不平衡的尾部会让接收会话的 token-meter 折叠在续写时报 step/end 无配对。
  // 尾部未闭合的 step 是中断运行的正常形状，由上游 resume 补 closers，保持原样。
  const events = balanceRewindPrefix(imported.events, { keepOpenTail: true });
  if (targetId !== undefined) {
    if (branch === undefined) {
      throw new Error("sessionBranch service is unavailable");
    }

    if (stopLoop !== undefined) await stopLoop(targetId);
    await branch.rewind(targetId, -1);

    const liveHandle = persistence.tracker.writerOf(targetId);
    if (liveHandle !== undefined) {
      if (events.length > 0) await liveHandle.append(events);
    } else {
      const handle = await persistence.open(targetId, "write");
      try {
        if (events.length > 0) await handle.append(events);
      } finally {
        await handle.close();
      }
    }
  } else {
    const handle = await persistence.create(
      { ...imported.meta, id },
      {
        inheritedEventCount: SessionLogOffset(
          Math.min(imported.inheritedEventCount, events.length),
        ),
      },
    );
    if (events.length > 0) await handle.append(events);
    await handle.close();
  }

  if (targetId !== undefined) {
    const live = sessions?.get(targetId);
    if (live !== undefined) {
      replaceLiveSessionLog(live, events);
      branch?.resetLiveDerivedState?.(live);
    }
  }
  return id;
}
