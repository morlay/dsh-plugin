// 右栏容器绑定的**当前会话**：`retain` / `release` 的配对逻辑（可测，不依赖 React 与装配）。
//
// 上游 `SidebarSessionViews` 管「多个会话的视图 + 卸载后释放」，我们只服务当前会话，所以这里是它的最小等价物：
// 切换时**先释放旧的、再 retain 新的**，同一会话不重复 retain。
import type { SessionController } from "../../contract/index.ts";

/** `sessions.retain(...)` 的返回值（会话作用域 reference，自带 `release`）。 */
type Retained = ReturnType<SessionController["retain"]>;

/** retain 的选项（与上游 `session-view.ts` 同一份语义）。 */
const RETAIN_OPTIONS = { source: "sidebarView", facets: { conversation: true } } as const;

/** 当前会话的绑定：谁在屏、它的 reference、以及释放动作。 */
export class SessionBinding {
  /** 已 retain 的记录（`undefined` 表示没有会话在屏）。 */
  private current: { readonly sessionId: string; readonly reference: Retained } | undefined;

  /**
   * @param sessions - 会话目录的**取法**（用 thunk 而不是实例：字段初始化时 `inject` 还是占位符，直接存实例会拿到空壳）。
   */
  constructor(private readonly sessions: () => Pick<SessionController, "retain">) {}

  /** 当前在屏会话 id（没有会话时 `undefined`）。 */
  get sessionId(): string | undefined {
    return this.current?.sessionId;
  }

  /** 容器要绑的作用域目标（没有会话时 `undefined`）。 */
  get reference(): Retained | undefined {
    return this.current?.reference;
  }

  /**
   * 切到某个会话：同一会话不动；否则**先释放旧的、再 retain 新的**。
   * @param sessionId - 在屏会话，`undefined` 表示没有会话在屏。
   */
  select(sessionId: string | undefined): void {
    if (sessionId === this.current?.sessionId) return;
    const previous = this.current;
    this.current = undefined;
    previous?.reference.release();
    if (sessionId === undefined) return;
    const reference = this.sessions().retain(
      sessionId as Parameters<SessionController["retain"]>[0],
      RETAIN_OPTIONS,
    );
    this.current = { sessionId, reference };
  }

  /** 卸载：释放当前会话。 */
  dispose(): void {
    this.select(undefined);
  }
}
