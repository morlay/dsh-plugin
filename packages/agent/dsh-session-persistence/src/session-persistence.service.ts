// session-persistence 行：**自己实现**（不转发上游 `session-persistence-jsonl` 插件）。
//
// 上游那个插件的 `apply` 会 `ctx.plugin({ apply: (serviceCtx) => new JsonlSessionPersistence(serviceCtx) })`，
// 服务注册在它自己建的子 fiber 上——我们的行作用域收不到，也不该依赖这种隐式约定。
// 这里按契约的五个方法直接落磁盘：`<dataDir>/sessions/<id>/{meta.json,events.jsonl}`。
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEvent, SessionHeader, SessionId } from "@morlay/dsh-session/endpoint";
import { SessionLogOffset } from "@morlay/dsh-session/server";
import { SessionPersistenceRevision, type SessionPersistenceStatOptions } from "@deepseek-ai/dsh-session-persistence";
import { type SessionAccess, type SessionHandle, type SessionHandleReadResult, type SessionPersistenceCreateOptions, type SessionPersistenceListOptions, type SessionPersistenceOpenOptions, type SessionPersistenceSnapshot } from "@deepseek-ai/dsh-session-persistence";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { type AppEnvValues } from "@morlay/zephyr-app";
import { AppEnv } from "@morlay/zephyr-app";
import { SessionPersistence } from "./contract/session-persistence.contract.ts";

/** 落盘的一份：header 原样存，`revision` 用本后端自己的计数（读时再换成不透明 token）。 */
interface StoredSession {
  readonly header: SessionHeader;
  readonly revision: number;
}

/**
 * 一次会话的写句柄：追加事件到 `events.jsonl`，读时按行切。
 *
 * 直接实现上游 `SessionHandle`（`id` / `header` / `access` / `inheritedEventCount` / `read` /
 * `append` / `flush` / `close` / `asyncDispose`）——不靠 cast 假装是这个形状。
 */
class FileSessionHandle implements SessionHandle {
  constructor(
    private readonly dir: string,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    readonly inheritedEventCount: SessionLogOffset,
    private readonly onFlush: () => Promise<void>,
  ) {}

  async read(offset = 0, length = Number.MAX_SAFE_INTEGER): Promise<SessionHandleReadResult> {
    const text = await readFile(join(this.dir, "events.jsonl"), "utf8").catch(() => "");
    const lines = text.split("\n").filter((line) => line !== "");
    const slice = lines.slice(offset, offset + length);
    return {
      // 读回来的对象是本句柄新建的（不与任何 store 共享），所以事件值是 `detached`。
      events: slice.map((line) => JSON.parse(line) as SessionEvent),
      eventState: "detached",
    };
  }

  async append(events: readonly SessionEvent[]): Promise<void> {
    if (this.access === "read") throw new Error("session handle 是只读的：open(id, 'read') 不能 append");
    if (events.length === 0) return;
    await appendFile(join(this.dir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }

  async flush(): Promise<void> {
    await this.onFlush();
  }

  async close(): Promise<void> {
    await this.onFlush();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

@Injectable()
export class SessionPersistenceDefault extends SessionPersistence implements OnInit {
  /** 实例身份：与上游同形（每个实现实例一个 symbol）。 */
  readonly identity = Symbol("sessionPersistence");

  private readonly appEnv: { readonly values: AppEnvValues } = inject(AppEnv);

  private root = "";

  onInit(_ctx: Context): void {
    this.root = join(this.appEnv.values.dataDir, "sessions");
  }

  private get rootDir(): string {
    if (this.root === "") throw new Error("session-persistence 未初始化：装配顺序错误");
    return this.root;
  }

  private dirOf(id: SessionId): string {
    return join(this.rootDir, encodeURIComponent(id));
  }

  private async writeMeta(id: SessionId, header: SessionHeader, revision: number): Promise<void> {
    const dir = this.dirOf(id);
    await mkdir(dir, { recursive: true });
    const meta: StoredSession = { header, revision };
    await writeFile(join(dir, "meta.json"), `${JSON.stringify(meta)}\n`, "utf8");
  }

  /** 本后端不写 fork 前缀：`inheritedEventCount` 恒 0（`isSeeded` 的会话不由这里创建）。 */
  private handleOf(
    id: SessionId,
    header: SessionHeader,
    access: SessionAccess,
    inheritedEventCount = SessionLogOffset(0),
  ): SessionHandle {
    return new FileSessionHandle(this.dirOf(id), id, header, access, inheritedEventCount, async () => {});
  }

  async create(header: SessionHeader, _options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    await this.writeMeta(header.id, header, 0);
    return this.handleOf(header.id, header, "write");
  }

  async open(
    id: SessionId,
    access: SessionAccess,
    _options?: SessionPersistenceOpenOptions,
  ): Promise<SessionHandle> {
    const meta = await this.readMeta(id);
    if (meta === undefined) throw new Error(`session '${String(id)}' 不存在`);
    return this.handleOf(id, meta.header, access);
  }

  async flush(): Promise<void> {
    // 每次 append 都直接落盘：没有需要额外 flush 的缓冲。
  }

  async stat(id: SessionId, _options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    const meta = await this.readMeta(id);
    if (meta === undefined) return undefined;
    return this.snapshotOf(meta);
  }

  async list(_options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const entries = await readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    const snapshots: SessionPersistenceSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await this.readMeta(entry.name as SessionId);
      if (meta !== undefined) snapshots.push(this.snapshotOf(meta));
    }
    return snapshots;
  }

  /** 落盘的计数 → 契约要的不透明 revision token（边界转换只在这里做一次）。 */
  private snapshotOf(meta: StoredSession): SessionPersistenceSnapshot {
    return { header: meta.header, revision: SessionPersistenceRevision(String(meta.revision)) };
  }

  private async readMeta(id: SessionId): Promise<StoredSession | undefined> {
    const text = await readFile(join(this.dirOf(id), "meta.json"), "utf8").catch(() => undefined);
    if (text === undefined) return undefined;
    return JSON.parse(text) as StoredSession;
  }
}
