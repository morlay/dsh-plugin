// 宿主侧的 `sessions` 服务：**与客户端共用同一个契约**（`SessionController`），实现不同。
//
// 上游 `api/session-controller` 只用 `ctx.sessions.get(id)`（4 处）；这里给一个内存表。
// 装了 agent 行时，建会话交给 `AgentLoop.create`（prepare + 落盘 + enter + announce 一次完成）；
// 没装 agent 行时只建会话本体与持久化 header（退化路径）。
// `session/*` 端点的注册与 wire 形状归契约类（`endpoint/session-endpoint.ts`），本类只提供目录数据面。
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  type Session,
  type SessionHeader,
} from "@deepseek-ai/dsh-session";
import { AgentDefaultModel, AgentLoop } from "@morlay/dsh-agent";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { RemoteHandlers } from "@morlay/zephyr-app";
import { SessionController, type SessionRetainHandle } from "../ui/session-controller.contract.ts";
import type { SessionPersistenceSnapshot } from "@morlay/dsh-session-persistence";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionProjectionStore } from "../contract/session-projection-store.contract.ts";
import { SessionStore } from "../contract/session.contract.ts";
import type {
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionListValue,
  SessionSummaryRow,
} from "../endpoint/session-endpoint.ts";
import { SessionWorkspace } from "../contract/session-workspace.contract.ts";

@Injectable()
export class SessionControllerHost extends SessionController implements OnInit {
  private readonly handlers = inject(RemoteHandlers);

  private readonly workspaceOf = inject(SessionWorkspace);

  private readonly persistence = inject(SessionPersistence);

  /**
   * 上游 `AgentLoop`：装了 agent 行时，`session/create` 要按上游语义「会话与 agent 一起建」。
   * optional：只有会话域的装配（spec、纯目录场景）没有它，那时只建会话本体。
   */
  private readonly agentLoop = inject.optional(AgentLoop);

  /**
   * 宿主侧投影注册表（上游 `sessionProjections`）：`session/follow` 的首帧与列表行从这里读
   * `modelSelection` 这类 wire 键。可选——只装会话域、不装 agent 行的装配没有它。
   */
  private readonly projections = inject.optional(SessionProjectionStore);

  /** agent 的默认模型选择：新建 agent 时交给 `AgentLoop.create`（没装 agent 行时为 undefined）。 */
  private readonly defaultModel = inject.optional(AgentDefaultModel);

  /** 真会话存储：`get` / `list` 都从这里读，不再维护一份模块级行表。 */
  private readonly store = inject(SessionStore);

  /** 行 ctx：恢复盘上会话要交给 `AgentLoop.resume` 当 owner（生命周期跟着这一行）。 */
  private rowContext: Context | undefined;

  onInit(ctx: Context): Promise<void> {
    this.rowContext = ctx;
    return this.attachStoredSessions();
  }

  /**
   * 启动时把**盘上已有**的会话挂回它们的工作区。
   *
   * 为什么必须做：`workspace/follow` 的 baseline 里 `sessionIds` 就取自 workspace 记录，而 attach 只在
   * `session/create` 时发生。reload 之后 live store 是空的，磁盘上那几十条会话谁也没挂过——
   * 于是工作区的 `sessionIds` 恒为空，侧栏只渲染出工作区、**没有一行会话**，点不到会话，
   * `sessions.binding()` 随之为空，权限 chip 与模型选择器一起静默早退。
   *
   * 只挂「cwd 命中某个已注册工作区」的会话：`resolve({ cwd })` 自己决定落到哪个工作区（可能是新建）。
   * 逐条 `attach` 是幂等的（`attachSession` 只补 `sessionIds`），失败不阻断启动（一条坏会话不该让整页起不来）。
   */
  private async attachStoredSessions(): Promise<void> {
    const snapshots = await this.persistence.list().catch(() => [] as readonly SessionPersistenceSnapshot[]);
    let attached = 0;
    for (const snapshot of snapshots) {
      const cwd = snapshot.header.cwd;
      if (cwd === undefined || cwd.length === 0) continue;
      try {
        const target = await this.workspaceOf.resolve({ cwd });
        await target.attach(SessionId(snapshot.header.id));
        attached += 1;
      } catch (error) {
        // 一条会话挂不上（目录被删、header 缺字段）不该让宿主起不来，但必须留痕。
        console.warn(`[sessions] 启动时把会话 "${snapshot.header.id}" 挂到工作区失败：`, error);
      }
    }
    // 不静默：挂了几条是判断"侧栏为什么还不出现会话"的第一手信息。
    console.info(`[sessions] 启动挂载：盘上 ${snapshots.length} 条会话，成功归到工作区 ${attached} 条`);
  }

  /**
   * `session/follow` 的帧序列：先给一帧 `snapshot`，然后挂到取消信号上。
   * @param request - 打开窗口的目标会话。
   * @param signal - 取消信号。
   * @returns 帧序列。
   */
  async *follow(
    request: SessionFollowRequest,
    signal: AbortSignal,
  ): AsyncGenerator<SessionFollowFrame> {
    const sessionId = request.address.sessionId;
    // reload 之后 live store 是空的，历史会话只在盘上：先恢复进 live store 再 follow，
    // 否则「点开一条历史会话」永远是 `no such session`（列表能列出、点开就报错）。
    let session = this.get(sessionId);
    if (session === undefined && this.persistence !== undefined) {
      const stored = await this.persistence.stat(SessionId(sessionId));
      if (stored !== undefined) session = await this.resumeStored(SessionId(sessionId), stored.header);
    }
    if (session === undefined) {
      throw new Error(`session/follow: no such session "${sessionId}"`);
    }
    const row = this.rowOf(session);
    // 首帧的投影块就是 Host 侧的完整 wire 快照：客户端的 `faceOf(key)` 读的就是它
    // （`modelSelection` 缺了这个键，模型选择器会永远停在 loading）。
    const projections = this.projections?.snapshot(session) ?? { asOfSeq: 0, values: {} };
    yield {
      type: "snapshot",
      header: {
        version: SESSION_FORMAT_VERSION,
        id: sessionId,
        createdAt: row.updatedAt,
        isSeeded: false,
        ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
      },
      cursor: 0,
      records: [],
      hasMore: false,
      projections: { asOfSeq: projections.asOfSeq, values: projections.values },
    };
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  }

  /**
   * 取一个**真的**会话实例（`store.get`；没有就 `undefined`，不造占位对象）。
   *
   * 上游 `SessionController` 的 21 个方法都要真 `Session`（`eventAt` / `append` / inbox），
   * 所以这里返回的是存储里那一份实例本身——调用方 `toBe` 能对上。
   * @param id - 会话 id。
   * @returns 会话实例或 `undefined`。
   */
  get(id: string): Session | undefined {
    return this.store.get(SessionId(id));
  }

  /**
   * 建一个空白会话（`remote.session.create`）。
   *
   * 与上游一致的三件事：`workspaceId` 与 `cwd` 互斥、`workspaceId` 决定 cwd、建好后把会话挂到 workspace 上
   * （否则 workspace 的 `sessionIds` 不变，页面上那张 workspace 行永远没有会话）。
   */
  async createSession(request: SessionCreateRequest): Promise<SessionCreateValue> {
    if (request.workspaceId !== undefined && request.cwd !== undefined) {
      throw new Error("session.create accepts workspaceId or cwd, not both");
    }
    // 先解析目标：workspace 不存在时**不建会话**（与上游同序）。
    const target = await this.workspaceOf.resolve({
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    });
    // **幂等**：请求带 `sessionId`、且那条会话**仍然空白**时复用，并确保挂到 workspace。
    // 上游 `commands.create` 的语义就是这样：`agents.createSession({ sessionId, reusable })` 在可复用时
    // 复用已有会话，而不是抛 `session "<id>" already exists`。`ui-workspace` 的 `restoreBlank` 正是拿
    // 一个已有 blank 的 id 来调这条（每次 reload 都会走）。
    //
    // **复用判据是「仍空白」**：有内容（live 的 `seq > 0`）或盘上有事件就不复用——这条请求的语义是
    // 「新建一个对话」，把有消息的会话原样返回会让 UI 停在那条 active 会话上，hero 永远不会出现。
    // 三种落点：仍空白 → 复用；全新 id（live 与盘上都没有）→ 用请求给的身份建；有内容 → 另铸一个。
    const explicit = request.sessionId;
    let requestedId: SessionId | undefined;
    if (explicit !== undefined) {
      const id = SessionId(explicit);
      const live = this.store.get(id);
      if (live !== undefined) {
        if (this.blankOf(live)) {
          await target.attach(id);
          return { sessionId: explicit };
        }
      } else {
        const stored = await this.persistence.stat(id);
        if (stored === undefined) {
          // 全新身份：没有可复用的东西，但请求指定了 id —— 就用它建。
          requestedId = id;
        } else if (await this.storedBlank(stored)) {
          // 只存在于盘上且仍空白（reload 后 live store 是空的）：恢复进 live store，
          // 否则 `session/list` 永远列不出它。
          // live header 必须取盘上那一份：手工 prepare 一个新 header 会让 live/盘上 header 不一致，
          // `SessionQuery.listSessions` 随后抛 `SESSION_QUERY_SOURCE_CONFLICT`（会话候选、prompt 全都挂）。
          await this.resumeStored(id, stored.header);
          await target.attach(id);
          return { sessionId: explicit };
        }
      }
      // 落到这里说明那个 id 已有内容：不能复用，按「不带 id 新建」继续走下面的铸号。
    }
    const sessionId = requestedId === undefined ? await this.mintSessionId() : String(requestedId);
    // 会话身份在这一侧铸一次（品牌 `SessionId`）：持久化、store、workspace 挂载用**同一个**值。
    const id = SessionId(sessionId);
    const session = await this.establish(id, target.cwd);
    await target.attach(id);
    this.handlers.publish("api-session/added", this.rowOf(session));
    return { sessionId };
  }

  /**
   * 建立一条**新的**会话。
   *
   * 装了 agent 行时按上游语义「会话与 agent 一起建」（`AgentLoop.create` 自己做 `prepare` + 落盘 +
   * `enter` + `announce`）：只把会话塞进 store 而不起 agent，后续 `session/prompt` 的 resume 会撞
   * `session "<id>" already exists`（resume 用 `sessions.prepare`，要求该 id 不在 store 里）。
   * 没装 agent 行（只有会话域的装配）时退回到只建会话本体。
   * @param id - 会话身份。
   * @param cwd - 会话的工作目录。
   * @returns store 里的会话实例。
   */
  private async establish(id: SessionId, cwd: string): Promise<Session> {
    const loop = this.agentLoop;
    if (loop !== undefined) {
      const model = this.defaultModel;
      // 空 selection 会让 `AgentLoop.create` 建出一个不可 prompt 的 agent：装了这一半就该报错。
      if (model === undefined) {
        throw new Error(
          "session/create：装了 agent 行但没有 agentDefaultModel（缺 provideAgent 的默认模型行）",
        );
      }
      const selection = model.currentSelection();
      await loop.create(
        id,
        {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: selection.reasoningEffort }),
        },
        { cwd },
      );
      const created = this.store.get(id);
      if (created === undefined) {
        throw new Error(`session/create：agent 起来后 store 里没有会话 "${id}"`);
      }
      return created;
    }
    // 会话要能落一条 header：workspace 挂载时会用 `sessionPersistence` 读它来校验 cwd
    // （`attachSession` → `readSessionHeader`）。只写内存的话挂载必然报
    // `session persistence holds no such session`。
    await this.persistence.create({
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: Date.now(),
      cwd,
      isSeeded: false,
    });
    // 真会话：`prepare` 造实例（校验 id / cwd），`enter` 发布进 store，`announce` 触发 `session/created`。
    const session = this.store.prepare(id, { meta: { cwd } });
    const release = this.store.enter(session);
    try {
      this.store.announce(session);
    } catch (error) {
      // 回滚：会话不能留在 store 里（否则会出现「列得出来但不在任何 workspace 里」的幽灵）。
      release();
      throw error;
    }
    return session;
  }

  /**
   * 把盘上已有的会话恢复成 live：装了 agent 行时走 `AgentLoop.resume`（会话与 agent 一起回来，
   * 之后 `prompt` 不会再撞 `session "<id>" already exists`，`agents.get` 也命中）；
   * 没装 agent 行时只补 live 会话本体，但 header 原样取盘上的那一份。
   * @param id - 盘上会话身份。
   * @param header - 盘上的 header（`persistence.stat` 读到的原文）。
   * @returns live store 里的会话实例。
   */
  private async resumeStored(id: SessionId, header: SessionHeader): Promise<Session> {
    const loop = this.agentLoop;
    if (loop !== undefined) {
      const model = this.defaultModel;
      // 与新建同口径：装了 agent 行却没有默认模型，会 resume 出一个不可 prompt 的 agent。
      if (model === undefined) {
        throw new Error(
          "session/create：装了 agent 行但没有 agentDefaultModel（缺 provideAgent 的默认模型行）",
        );
      }
      const owner = this.rowContext;
      if (owner === undefined) {
        throw new Error("session/create：行 ctx 未初始化，无法 resume 盘上会话");
      }
      const selection = model.currentSelection();
      await loop.resume(owner, {
        resumeSessionId: id,
        agentOptions: {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: selection.reasoningEffort }),
        },
      });
      const resumed = this.store.get(id);
      if (resumed === undefined) {
        throw new Error(`session/create：resume 后 store 里没有会话 "${id}"`);
      }
      return resumed;
    }
    // 没装 agent 行（只有会话域的装配）：只补 live 会话本体，header 必须是盘上原文。
    const session = this.store.prepare(id, { meta: structuredClone(header) });
    const release = this.store.enter(session);
    try {
      this.store.announce(session);
    } catch (error) {
      release();
      throw error;
    }
    return session;
  }

  /**
   * 铸一个不与**已落盘**会话冲突的 `session-<n>`。
   *
   * 不能用 `store.list().length + 1`：reload 后 live store 是空的，而盘上已经有 `session-1…N`，
   * 那样第一次新建就会撞 `session "session-1" already exists`。
   * @returns 新的会话 id。
   */
  private async mintSessionId(): Promise<string> {
    const existing = new Set<string>();
    for (const snapshot of await this.persistence.list()) existing.add(String(snapshot.header.id));
    for (const session of this.store.list()) existing.add(String(session.id));
    let n = existing.size + 1;
    while (existing.has(`session-${n}`)) n += 1;
    return `session-${n}`;
  }

  /**
   * 宿主侧对外的会话列表（`remote.session.list` 的数据源）：**live store ∪ 持久化盘**。
   *
   * 只从 `store.list()` 派生会让宿主重启后目录变空（live store 是空的，盘上却有历史）——
   * 客户端拿到空目录，侧栏与主区都退回空态。所以盘上的 header 也进目录：live 优先，
   * 盘上独有的会话补在后面（按 `createdAt` 新的在前）。
   *
   * 行上的 `blank` 是「这条会话有没有事件」：live 用 `session.seq`，盘上用事件数（见 {@link storedBlank}）。
   * @returns 目录身份表与逐行快照。
   */
  async snapshotForRemote(): Promise<SessionListValue> {
    const rows: SessionSummaryRow[] = [];
    const live = new Map<string, SessionSummaryRow>();
    for (const session of this.store.list()) {
      const row = this.rowOf(session);
      live.set(row.id, row);
      rows.push(row);
    }
    const stored = [...(await this.persistence.list())].sort(
      (left, right) => right.header.createdAt - left.header.createdAt,
    );
    for (const snapshot of stored) {
      const id = String(snapshot.header.id);
      if (live.has(id)) continue;
      rows.push(await this.storedRowOf(snapshot));
    }
    return {
      ids: rows.map((row) => row.id),
      byId: Object.fromEntries(rows.map((row) => [row.id, row])),
    };
  }

  /**
   * 一条**只在盘上**的会话 → wire 行（宿主重启后没有 live 实例）。
   * @param snapshot - 持久化层的快照（header + revision）。
   * @returns 列表用的行。
   */
  private async storedRowOf(snapshot: SessionPersistenceSnapshot): Promise<SessionSummaryRow> {
    const header = snapshot.header;
    const id = String(header.id);
    const agentPreset = header.agentPreset;
    return {
      id,
      sessionId: id,
      title: "新会话",
      cwd: header.cwd ?? "",
      blank: await this.storedBlank(snapshot),
      running: false,
      agentAvailable: true,
      updatedAt: header.createdAt,
      retainedBy: {},
      ...(agentPreset === undefined
        ? {}
        : {
            projections: {
              kind: "sequenced" as const,
              asOfSeq: snapshot.eventCount ?? 0,
              values: { agentPreset },
            },
          }),
    };
  }

  /**
   * 盘上的会话是不是**空白会话**：日志里没有任何 `turn/start`（与 live 的 {@link blankOf} 同一判据）。
   *
   * 只看「有没有事件」是不够的：agent 建立会话时会写 `session/end-seed`，盘上照样是空白会话。
   * 按契约分页读事件（`open` + `read`），不直读磁盘文件；读失败时按「有历史」处理——
   * 宁可放在底部输入栏，也不把有消息的会话做成居中 hero。
   * @param snapshot - 持久化层的快照。
   * @returns 空白会话为 true。
   */
  private async storedBlank(snapshot: SessionPersistenceSnapshot): Promise<boolean> {
    if (snapshot.eventCount === 0) return true;
    const pageSize = 200;
    try {
      const handle = await this.persistence.open(snapshot.header.id, "read");
      try {
        for (let offset = 0; ; offset += pageSize) {
          const { events } = await handle.read(offset, pageSize);
          if (events.some((event) => event.type === "turn/start")) return false;
          if (events.length < pageSize) return true;
        }
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }

  /**
   * 一条真会话 → wire 上的 `SessionSummary` 形状。
   * @param session - store 里的会话实例。
   * @returns 列表 / 推送载荷用的行。
   */
  private rowOf(session: Session): SessionSummaryRow {
    const agentPreset = session.header.agentPreset;
    // 列表行带**已 materialize** 的投影值（零 I/O 读，不 fold 历史）：`blank` 会话也能立刻给出
    // `modelSelection` 这类键。`agentPreset` 来自 header，不在投影表里，单独并进来。
    const cached = this.cachedProjectionsOf(session);
    const values: Record<string, unknown> = { ...cached.values };
    if (agentPreset !== undefined) values.agentPreset = agentPreset;
    return {
      id: session.id,
      sessionId: session.id,
      title: "新会话",
      cwd: session.header.cwd ?? "",
      blank: this.blankOf(session),
      running: false,
      agentAvailable: true,
      updatedAt: session.header.createdAt,
      retainedBy: {},
      ...(Object.keys(values).length === 0
        ? {}
        : {
            projections: {
              kind: "sequenced" as const,
              asOfSeq: cached.asOfSeq ?? session.seq,
              values,
            },
          }),
    };
  }

  /**
   * 一条 live 会话是不是**空白会话**（还没有过 turn）。
   *
   * 判据与上游 `applySessionListMetadata` 一致：**只有 `turn/start` 结束空白状态**。
   * 不能用 `session.seq === 0`：agent 建立会话时会写 `session/end-seed`，`seq` 立刻变成 1，
   * 那样每个新会话都会被判成「有内容」，hero 与「新建会话」都会失效。
   * @param session - store 里的会话实例。
   * @returns 空白会话为 true。
   */
  private blankOf(session: Session): boolean {
    const metadata = this.cachedProjectionsOf(session).values.sessionListMetadata as
      | { readonly blank?: unknown }
      | undefined;
    if (typeof metadata?.blank === "boolean") return metadata.blank;
    return !session.ownEvents().some((event) => event.type === "turn/start");
  }

  /**
   * 一条 live 会话的投影值（**只读已缓存 cell**，不触发历史折叠）。
   *
   * 宿主没装投影行（纯目录装配）时回空值：调用方只关心「有没有键」。
   * @param session - store 里的会话实例。
   * @returns 已缓存的投影块；没有时 `values` 为空对象。
   */
  private cachedProjectionsOf(session: Session): {
    asOfSeq: number | undefined;
    values: Readonly<Record<string, unknown>>;
  } {
    try {
      const cached = this.projections?.cachedSnapshot(session);
      return cached === undefined
        ? { asOfSeq: undefined, values: {} }
        : { asOfSeq: cached.asOfSeq, values: cached.values };
    } catch {
      // 投影行的读取失败不能拖垮目录：行照常给（缺投影键即可）。
      return { asOfSeq: undefined, values: {} };
    }
  }

  /** 客户端面的 `create`：宿主侧走 `remote.session.create` 那一条路，这里不需要。 */
  async create(
    _opts?: Parameters<SessionController["create"]>[0],
  ): ReturnType<SessionController["create"]> {
    throw new Error(
      "SessionControllerHost.create：宿主侧应调用 remote.session.create，而不是本地 create",
    );
  }

  /** 客户端面的投影刷新：宿主侧没有这一层。 */
  async refreshProjections(
    _sessionId: Parameters<SessionController["refreshProjections"]>[0],
  ): ReturnType<SessionController["refreshProjections"]> {
    return undefined;
  }

  /**
   * 客户端面：宿主侧不需要（客户端那份实现负责），给一份**空的 ready 快照**以满足同一个契约。
   *
   * 空快照的四项都是 `SessionCatalogState` 的真值：没有会话（`ids` 空、`byId` 与投影表空）且已经取完
   * （`phase: "ready"`）；不变量是「宿主不持目录」——目录由 Host 列表经 wire 交给客户端。
   */
  readonly list: SessionController["list"] = {
    getSnapshot: () => ({ ids: [], byId: {}, phase: "ready", projectionsBySession: {} }),
    subscribe: () => () => {},
  };

  binding(_id: string): unknown {
    return undefined;
  }

  retainInfo(_id: string): { getSnapshot(): unknown; subscribe(fn: () => void): () => void } {
    return { getSnapshot: () => ({ retainedBy: {} }), subscribe: () => () => {} };
  }

  retain(target: Parameters<SessionController["retain"]>[0]): SessionRetainHandle {
    // 目标可能是普通会话，也可能是子代理地址；两者都带一个真正的会话身份（子代理用子会话）。
    const sessionId = typeof target === "string" ? target : target.childSessionId;
    return {
      sessionId,
      binding: undefined,
      ready: Promise.resolve(undefined),
      release: () => {},
      dispose: () => {},
    };
  }

  scope(): undefined {
    return undefined;
  }

  sessionOf(): undefined {
    return undefined;
  }

  scopeOf(): undefined {
    return undefined;
  }

  /** 宿主侧的目录由 `remote.session.list` 交给客户端：这里没有需要重拉的本地缓存。 */
  async refresh(): Promise<void> {
    return;
  }

  subagentAddress(): undefined {
    return undefined;
  }

  readonly searchResultLimit = 20;

  async search(): Promise<never> {
    throw new Error("SessionControllerHost.search：宿主侧没有搜索面");
  }

  async fork(): Promise<never> {
    throw new Error("SessionControllerHost.fork：宿主侧没有分叉面");
  }

  async using<T>(
    _target: Parameters<SessionController["using"]>[0],
    _options: Parameters<SessionController["using"]>[1],
    operation: (reference: SessionRetainHandle) => T | Promise<T>,
  ): Promise<T> {
    return operation(this.retain(_target));
  }
}
