// 右栏的**外壳**（root 座位 `rightbar`）：`<aside>` + 会话作用域入口。
//
// **props 只来自两处**（这是硬判据，前三次 bug 都是「第三类」props 造成的）：
// ① 注册行 `inject` 给的：`session` / `labels`；
// ② 渲染器／父在 `renderSlot` 时给的：`renderSlot` / `SessionProvider` / `canShow`（AppFrame 的 owner props）。
// 不出现「旧实现自己发明的」字段（`useRightbar` / `viewportWidth` / `expanded`）——它们没有提供者。
import type { ReactNode } from "react";
import type { RenderOpts } from "@deepseek-ai/dsh-client-ui-slots";
import css from "./rightbar.module.css";

/** 渲染 `rightbar.session` 的回调（形状 = 上游 `RenderSlotFn`）。 */
export type RightbarRenderSlot = (key: "rightbar.session", owner: object, opts?: RenderOpts) => ReactNode;

/** 会话区域组件（渲染器给：children 里声明了 session 作用域）。 */
export type RightbarSessionProvider = (props: { readonly session?: unknown; readonly children: ReactNode }) => ReactNode;

/** 外壳文案（注册行 `inject` 给）。 */
export interface RightbarLabels {
  /** 面板的无障碍名。 */
  readonly title: string;
  /** 没有会话在屏时的说明。 */
  readonly empty: string;
}

/** 外壳的 props。 */
export interface RightbarProps {
  /** ① 当前会话的作用域目标（`SessionReference`）；没有会话时 `undefined`。 */
  readonly session: unknown;
  /** ① 文案。 */
  readonly labels: RightbarLabels;
  /** ② 帧是否还留着这一列的轨道（AppFrame 的 owner props：`normal.rightbar > 0`）。 */
  readonly canShow: boolean;
  /** ② 渲染 session 座位（渲染器给）。 */
  readonly renderSlot: RightbarRenderSlot;
  /** ② 包会话作用域（渲染器给）。 */
  readonly SessionProvider: RightbarSessionProvider;
}

/**
 * 右栏外壳。
 * @param props - 会话目标、文案、帧的可见性，以及两个渲染器座位。
 * @returns 右列元素。
 */
export function Rightbar({ session, labels, canShow, renderSlot, SessionProvider }: RightbarProps): ReactNode {
  return (
    <aside className={css.panel} aria-label={labels.title} data-role="rightbar" hidden={!canShow}>
      {session === undefined ? (
        <p className={css.notice}>{labels.empty}</p>
      ) : (
        <SessionProvider session={session}>{renderSlot("rightbar.session", {})}</SessionProvider>
      )}
    </aside>
  );
}
