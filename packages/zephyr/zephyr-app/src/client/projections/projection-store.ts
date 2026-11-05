// 投影值 store：**宿主算、客户端读**的通用容器（上游 `ProjectionValueStore` 的等价物）。
//
// 为什么它是框架的一部分而不是某个领域的私货：权限档位、模型选择、标题、inbox……所有"宿主算出、
// 界面要读"的值都走同一套语义：
//
//   - **sequenced 行带 `seq`**：同一键上高 seq 胜，重放的帧与旧基线都盖不掉新值；
//   - **cached 行不带 seq**：它只是"持久化检查点的只读一瞥"，任何 sequenced 写入都能盖掉它；
//   - **`seed(baseline)`** 是打开会话时的整体校准：先丢弃所有 cached 行，再按同一 seq 规则落值，
//     最后清掉基线里没有的键（但不清比基线更新的 sequenced 行）；
//   - **face 是 identity-stable 的**：React 侧每个键只绑一次；
//   - **`values()` 引用稳定**：整体读的一方（列表重建）靠它避免无谓重算。
//
// 这些规则一旦在领域里各写一遍，就会出现"看起来能用、偶尔回退"的时序 bug（实机上表现为
// 切了权限 chip 文案不动、打开会话看到旧档位）。

/** 一个键的读面（`useSyncExternalStore` 直接吃）。 */
export interface ProjectionFace {
  /** 当前值；键从未出现过时是 `undefined`（能力缺失，不是错误）。 */
  getSnapshot(): unknown;

  /**
   * 订阅这个键的变化。
   * @param listener - 变化回调。
   * @returns 退订函数。
   */
  subscribe(listener: () => void): () => void;
}

/** 一行：宿主算出的值，以及它是否带可比的水位。 */
type Row = { readonly kind: "cached"; readonly value: unknown } | { readonly kind: "sequenced"; readonly value: unknown; readonly seq: number };

/** 一帧基线（`session/control` 的 `baseline.projections[sessionId]`，或 `follow` 首帧的 `projections`）。 */
export interface ProjectionBaseline {
  /** 这一批值所属的日志位置。 */
  readonly asOfSeq: number;
  /** 按键的整值。 */
  readonly values: Readonly<Record<string, unknown>>;
}

/** 微任务批量通知：同一拍内的多次写入只唤醒一次订阅者。 */
class BatchNotifier {
  private readonly listeners = new Set<() => void>();

  private scheduled = false;

  /**
   * 订阅。
   * @param listener - 变化回调。
   * @returns 退订函数。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 标记有变化（同一拍合并成一次通知）。 */
  markDirty(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const listener of Array.from(this.listeners)) listener();
    });
  }
}

/** 一个会话（或任何 owner）的全部投影值。 */
export class ProjectionValueStore {
  private readonly rows = new Map<string, Row>();

  private readonly channels = new Map<string, { readonly face: ProjectionFace; readonly notifier: BatchNotifier }>();

  private readonly anyNotifier = new BatchNotifier();

  private valuesCache: Readonly<Record<string, unknown>> | undefined;

  /**
   * 一个键的读面（identity-stable，可先订阅后才有值）。
   * @param key - 投影键。
   * @returns 读面。
   */
  faceOf(key: string): ProjectionFace {
    const existing = this.channels.get(key);
    if (existing !== undefined) return existing.face;
    const notifier = new BatchNotifier();
    const face: ProjectionFace = {
      getSnapshot: () => this.rows.get(key)?.value,
      subscribe: (listener) => notifier.subscribe(listener),
    };
    this.channels.set(key, { face, notifier });
    return face;
  }

  /**
   * 当前值（不订阅）。
   * @param key - 投影键。
   * @returns 值；键缺席时 `undefined`。
   */
  get(key: string): unknown {
    return this.rows.get(key)?.value;
  }

  /**
   * 已接受的水位。
   * @param key - 投影键。
   * @returns sequenced 行的 `seq`；cached 行或缺失是 `undefined`。
   */
  seqOf(key: string): number | undefined {
    const row = this.rows.get(key);
    return row?.kind === "sequenced" ? row.seq : undefined;
  }

  /**
   * 整体快照（引用稳定：行不变就是同一个对象）。
   * @returns 键 → 值。
   */
  values(): Readonly<Record<string, unknown>> {
    if (this.valuesCache === undefined) {
      const next: Record<string, unknown> = {};
      for (const [key, row] of this.rows) next[key] = row.value;
      this.valuesCache = Object.freeze(next);
    }
    return this.valuesCache;
  }

  /**
   * 订阅任意键的变化（列表重建这类粗粒度消费方用）。
   * @param listener - 变化回调。
   * @returns 退订函数。
   */
  subscribeAny(listener: () => void): () => void {
    return this.anyNotifier.subscribe(listener);
  }

  /**
   * 写入一帧**宿主算出的**值（`session/control` 的 `projection` 帧）。
   * @param key - 投影键。
   * @param value - 整值。
   * @param seq - 该值的日志位置。
   */
  apply(key: string, value: unknown, seq: number): void {
    const row = this.rows.get(key);
    // sequenced 之间高 seq 胜：重放帧与旧帧都丢掉。cached 行没有可比水位，无条件让位。
    if (row?.kind === "sequenced" && seq <= row.seq) return;
    this.rows.set(key, { kind: "sequenced", value, seq });
    this.changed(key);
  }

  /**
   * 用**持久化检查点的一瞥**填键（`session/list` 行上的 cached 值）。
   *
   * 只填还没有 sequenced 行的键：连上的会话已经回答过这个键，列表那份不可能更新。
   * @param values - 键 → 值。
   */
  applyCached(values: Readonly<Record<string, unknown>>): void {
    for (const [key, value] of Object.entries(values)) {
      if (this.rows.get(key)?.kind === "sequenced") continue;
      this.rows.set(key, { kind: "cached", value });
      this.changed(key);
    }
  }

  /**
   * 用一帧基线整体校准（打开会话时的 `follow` 首帧 / `control` 的 baseline）。
   *
   * 规则（与上游逐条一致）：先丢弃所有 cached 行——基线来自连上的会话，检查点那份永远不高于它；
   * 再按 `apply` 的 seq 规则落每个键；最后清掉基线里没有的键，但不清比基线更新的那些。
   * @param baseline - 基线块。
   */
  seed(baseline: ProjectionBaseline): void {
    for (const [key, row] of Array.from(this.rows)) {
      if (row.kind !== "cached") continue;
      this.rows.delete(key);
      this.changed(key);
    }
    for (const [key, value] of Object.entries(baseline.values)) {
      this.apply(key, value, baseline.asOfSeq);
    }
    for (const [key, row] of Array.from(this.rows)) {
      if (Object.hasOwn(baseline.values, key)) continue;
      if (row.kind === "sequenced" && row.seq > baseline.asOfSeq) continue;
      this.rows.delete(key);
      this.changed(key);
    }
  }

  /** 丢弃全部值（连接代变化时用；已订阅的 face 保留，消费者不必重绑）。 */
  clear(): void {
    for (const key of Array.from(this.rows.keys())) {
      this.rows.delete(key);
      this.changed(key);
    }
  }

  /**
   * 一个键变了：清缓存 + 通知这个键的订阅者 + 通知任意键的订阅者。
   * @param key - 投影键。
   */
  private changed(key: string): void {
    this.valuesCache = undefined;
    this.channels.get(key)?.notifier.markDirty();
    this.anyNotifier.markDirty();
  }
}
