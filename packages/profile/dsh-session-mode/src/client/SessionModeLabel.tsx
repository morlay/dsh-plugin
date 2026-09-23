/**
 * 会话头部的模式标签：**只读**。
 *
 * 一个会话的装配在它开始第一轮时就定下了，头部又是"跑起来之后"才值得看的东西——在这里放一个能切模式的
 * 控件，等于承诺一次 host 会拒绝的切换。说出这个会话运行的是什么，才是这里诚实的表述；选择本身在
 * 新会话屏幕的 chip 上。
 */

import { IconAgentPresetOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：拉入本包 host 半的投影声明（`sessionMode`）。
import type {} from "../index.ts";
// Type-only：拉入 ui-conversation 的 SlotMap 合并（头部动作行）。
import type {} from "@morlay/dsh-client-ui-conversation/client";
import { useRoster } from "./use-roster.ts";
import css from "./SessionModeLabel.module.css";

/** 完整 props：头部动作槽位的运行时 props + 本包的字典。 */
export type SessionModeLabelProps = PropsRuntime<"conversation.session.header.actions"> &
  PropsLocale<"session-mode">;

/**
 * 渲染这个会话的模式名。
 * @param props - 槽位合成的 props。
 * @returns 标签；清单没读到时返回 null（此时名字无从得知）。
 */
export function SessionModeLabel({ sessionId, useSessions, t }: SessionModeLabelProps) {
  const roster = useRoster();
  const mode = useSessions((state) => {
    const value = state.byId[sessionId]?.projectionValues?.sessionMode;
    return typeof value === "string" ? value : undefined;
  });

  if (roster === undefined) return null;

  const id = mode ?? roster.default;
  const chosen = roster.modes.find((entry) => entry.id === id);
  return (
    <span className={css.label} title={chosen?.description ?? t("headerHint")}>
      <IconAgentPresetOutlineRegular size={14} className={css.icon} />
      {chosen?.name ?? id}
    </span>
  );
}
