// 投影 hub：**把 `session/control` 这条宿主流接到每个会话的 `ProjectionValueStore` 上**。
//
// 分工（与上游一致）：
//   - 宿主：`SessionControlController` 算投影、推 `baseline` + `projection` 帧；
//   - 框架（这里）：维护"会话 → 投影 store"，消费那条流，按 `seq` 语义写入；
//   - 领域：只读 `faceOf(sessionId, key)`，不碰流、不碰 seq。
//
// 少了这一层，每个领域都要自己 for-await 一条流、自己写 seq 比较——就会各自写出"偶尔回退"的时序 bug。
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { Remote } from "../../remote/remote.contract.ts";
import { Connection } from "../../connection/contract.ts";
import { ProjectionValueStore, type ProjectionFace } from "./projection-store.ts";

/** 一帧控制流（`session/control` 的 `SessionControlFrame`）。 */
interface ControlFrame {
  readonly type?: string;
  readonly value?: { readonly projections?: Record<string, { readonly asOfSeq?: number; readonly values?: Record<string, unknown> }> };
  readonly sessionId?: string;
  readonly key?: string;
  readonly seq?: number;
}

/** 框架对外给出的投影读面。 */
@Injectable()
export abstract class Projections {
  /**
   * 某个会话的一个投影键的读面（identity-stable，可先订阅后才有值）。
   * @param sessionId - 会话身份。
   * @param key - 投影键（`permissions` / `modelSelection` / `title`…）。
   * @returns 读面。
   */
  abstract faceOf(sessionId: string, key: string): ProjectionFace;

  /**
   * 某个会话的整份投影 store（要 `values()` / `subscribeAny()` 的消费方用）。
   * @param sessionId - 会话身份。
   * @returns store（不存在就建一个空的）。
   */
  abstract storeOf(sessionId: string): ProjectionValueStore;

  /**
   * 用一帧基线校准某个会话（`session/follow` 首帧的 `projections` 走这里）。
   * @param sessionId - 会话身份。
   * @param baseline - 基线块。
   */
  abstract seed(sessionId: string, baseline: { readonly asOfSeq: number; readonly values: Readonly<Record<string, unknown>> }): void;

  /**
   * 用列表行上的 cached 值填空（只在没有 sequenced 行时生效）。
   * @param sessionId - 会话身份。
   * @param values - 键 → 值。
   */
  abstract applyCached(sessionId: string, values: Readonly<Record<string, unknown>>): void;
}

/** 默认实现：订阅 `remote.session.control`，把帧分发给对应会话的 store。 */
@Injectable()
export class ProjectionsDefault extends Projections implements OnInit, OnDispose {
  private readonly remote = inject(Remote);

  /**
   * 连接面：**可选**。有它才跟连接代换代（换连接 = 旧值作废）；
   * 只装数据面的场景（会话目录的单元测试、纯 node）没有它，按单代跑。
   */
  private readonly connection = inject.optional(Connection);

  private readonly stores = new Map<string, ProjectionValueStore>();

  /** 当前连接代：换代时清空所有值（旧代的帧不能留到新一代）。 */
  private generation: number | undefined;

  private stopStream: (() => void) | undefined;

  onInit(): void {
    const connection = this.connection;
    if (connection !== undefined) {
      this.generation = connection.generation.getSnapshot()?.id;
      this.stopGeneration = connection.generation.subscribe(() => {
        const next = connection.generation.getSnapshot()?.id;
        if (next === this.generation) return;
        this.generation = next;
        // 换代：值全部作废（面保留），再重开流拿新基线。
        for (const store of this.stores.values()) store.clear();
        this.open();
      });
    }
    // 等 `session` namespace 挂上再开流：装配期 `remote.session` 还不在（或挂到未就绪的
    // typert gateway 上），那时开会以一条错误结束，而这条流之后没有别的时机再被重开。
    void this.remote.whenMounted().then(() => {
      if (this.disposed) return;
      this.open();
    });
  }

  faceOf(sessionId: string, key: string): ProjectionFace {
    return this.storeOf(sessionId).faceOf(key);
  }

  /**
   * 卸载：先中止流再退出。
   *
   * 中止放在前面，`catch` 里才能用 `signal.aborted` 把"正常收尾"与"真断连"分开——
   * 否则每次关页面都会打一条 `session/control 结束于错误`。
   */
  onDispose(): void {
    this.disposed = true;
    this.stopStream?.();
    this.stopStream = undefined;
    this.stopGeneration?.();
  }

  /** 卸载标记：`whenMounted()` 迟到的兑现不能再开流。 */
  private disposed = false;

  /** 连接代的订阅退订函数。 */
  private stopGeneration: (() => void) | undefined;

  storeOf(sessionId: string): ProjectionValueStore {
    const existing = this.stores.get(sessionId);
    if (existing !== undefined) return existing;
    const store = new ProjectionValueStore();
    this.stores.set(sessionId, store);
    return store;
  }

  seed(sessionId: string, baseline: { readonly asOfSeq: number; readonly values: Readonly<Record<string, unknown>> }): void {
    this.storeOf(sessionId).seed(baseline);
  }

  applyCached(sessionId: string, values: Readonly<Record<string, unknown>>): void {
    this.storeOf(sessionId).applyCached(values);
  }

  /** 开一条 `session/control` 流（幂等：先停旧的）。 */
  private open(): void {
    this.stopStream?.();
    const namespace = (this.remote as unknown as Record<string, unknown>)["session"];
    const control = (namespace as { control?: unknown } | undefined)?.control;
    if (typeof control !== "function") {
      // 不静默：没有这条流，界面上所有"宿主算出来的值"都不会更新。
      console.warn("[projections] remote.session.control 不存在：投影不会随宿主更新（界面会停在旧值）");
      return;
    }
    const controller = new AbortController();
    this.stopStream = () => {
      controller.abort();
    };
    const stream = (control as (signal: AbortSignal) => AsyncIterable<ControlFrame>).call(
      namespace,
      controller.signal,
    );
    void (async (): Promise<void> => {
      try {
        for await (const frame of stream) {
          this.accept(frame);
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("[projections] session/control 结束于错误：", error);
      }
    })();
  }

  /**
   * 一帧控制流 → store。
   * @param frame - `baseline` 或 `projection`。
   */
  private accept(frame: ControlFrame): void {
    if (frame.type === "baseline") {
      for (const [sessionId, block] of Object.entries(frame.value?.projections ?? {})) {
        this.storeOf(sessionId).seed({ asOfSeq: block.asOfSeq ?? 0, values: block.values ?? {} });
      }
      return;
    }
    if (frame.type === "projection" && frame.sessionId !== undefined && typeof frame.key === "string") {
      this.storeOf(frame.sessionId).apply(frame.key, frame.value, frame.seq ?? 0);
    }
  }
}

export { ProjectionValueStore, type ProjectionFace } from "./projection-store.ts";
