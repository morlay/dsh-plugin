/**
 * 新会话屏幕上的模式 chip：**切换列表**就在这里（点开是 coding / chat 两项）。
 *
 * 为什么住在新会话屏幕而不是输入框上方：选择只在会话开始**之前**有效——一旦跑过 turn，那段历史是在某个
 * 模式的工具与提示词下产生的，host 会拒绝换（与上游 `agentPresets.select` 同一条判据）。一个大半辈子都
 * 该禁用的控件，放在它仍然可用的那块屏幕上更诚实。
 */

import { useState } from "react";
import {
  IconAgentPresetOutlineRegular,
  IconChevronDownOutlineRegular,
  Menu,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：拉入本包 host 半的 Context / 投影声明（`sessionMode`），让 `projectionValues` 有类型。
import type {} from "../index.ts";
// Type-only：拉入 ui-conversation 的 SlotMap 合并（hero 的座位）。
import type {} from "@morlay/dsh-client-ui-conversation/client";
import { selectMode } from "./api.ts";
import { useRoster } from "./use-roster.ts";
import css from "./SessionModeSeat.module.css";

/** 完整 props：hero 槽位的运行时 props + 本包的字典。 */
export type SessionModeSeatProps = PropsRuntime<"conversation.hero.agentPreset"> &
  PropsLocale<"session-mode">;

/**
 * 渲染新会话的模式 chip。
 * @param props - 槽位合成的 props。
 * @returns chip；清单没读到、或不是主视图的会话时返回 null。
 */
export function SessionModeSeat({
  sessionId,
  useSessions,
  useSessionRetainInfo,
  t,
}: SessionModeSeatProps) {
  const roster = useRoster();
  const selected = useSessions((state) => {
    const value =
      sessionId === undefined ? undefined : state.byId[sessionId]?.projectionValues?.sessionMode;
    return typeof value === "string" ? value : undefined;
  });
  const main = useSessionRetainInfo(
    (info) => sessionId === undefined || (info?.retainedBy.mainView ?? 0) > 0,
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!main || roster === undefined) return null;

  const current = selected ?? roster.default;
  const chosen = roster.modes.find((mode) => mode.id === current);
  const label = chosen?.name ?? current;

  return (
    <Menu
      open={open}
      onClose={() => {
        setOpen(false);
      }}
      items={roster.modes.map((mode) => ({
        id: mode.id,
        label: (
          <span className={css.item}>
            <span className={css.itemName}>{mode.name}</span>
            <span className={css.itemDesc}>{mode.description ?? t("noDescription")}</span>
          </span>
        ),
      }))}
      selectedId={current}
      onSelect={(id) => {
        setOpen(false);
        if (sessionId === undefined || id === current) return;
        setBusy(true);
        setError(null);
        void selectMode(sessionId, id)
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
      align="start"
      portal
      className={css.menuAnchor}
      anchor={
        <button
          type="button"
          className={css.seat}
          aria-haspopup="menu"
          aria-expanded={open}
          title={error ?? t("seatHint")}
          disabled={busy}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <IconAgentPresetOutlineRegular className={css.seatIcon} />
          <span className={css.seatLabel}>{label}</span>
          <IconChevronDownOutlineRegular className={css.chevron} />
        </button>
      }
    />
  );
}
