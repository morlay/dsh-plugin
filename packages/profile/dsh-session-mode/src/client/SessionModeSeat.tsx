// composer 里的模式 chip：本包在会话里唯一的面（点开是 coding / chat 两项）。
// 选择只在会话开始**之前**有效（那段历史属于某个模式的工具与提示词），所以 chip 有两个形态：空白期是选择器，
// 开过 turn 之后只读。判据是 host 的投影 `sessionModeEditable`，与服务端拒绝切换读的是同一份事实。

import { useState } from "react";
import {
  IconAgentPresetOutlineRegular,
  IconChevronDownOutlineRegular,
  Menu,
  SeatButton,
  Stack,
  Text,
} from "@morlay/dsh-client-ui-primitives/client";
import type { PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only：拉入本包 host 半的 Context / 投影声明（`sessionMode`），让 `projectionValues` 有类型。
import type {} from "../index.ts";
// Type-only：拉入 ui-conversation 的 SlotMap 合并（composer 工具行的座位）。
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import { selectMode } from "./api.ts";
import { useRoster } from "./use-roster.ts";

// 完整 props：composer 工具行左侧槽位的运行时 props + 本包的字典。
export type SessionModeSeatProps = PropsRuntime<"conversation.input.left"> &
  PropsLocale<"session-mode">;

// 渲染 composer 里的模式切换 chip：新会话屏也是 blank session 的 composer，选择正好发生在那里；官方 roster 占了
// 单注册槽位 `conversation.hero.agentPreset`，所以这里用自己的 list 槽位并存。清单没读到时会话未知时返回 null。
export function SessionModeSeat({ sessionId, useSessions, t }: SessionModeSeatProps) {
  const roster = useRoster();
  const selected = useSessions((state) => {
    const value =
      sessionId === undefined ? undefined : state.byId[sessionId]?.projectionValues?.sessionMode;
    return typeof value === "string" ? value : undefined;
  });
  const editable = useSessions((state) => {
    const value =
      sessionId === undefined
        ? undefined
        : state.byId[sessionId]?.projectionValues?.sessionModeEditable;
    return typeof value === "boolean" ? value : undefined;
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (roster === undefined) return null;

  const current = selected ?? roster.default;
  const chosen = roster.modes.find((mode) => mode.id === current);
  const label = chosen?.name ?? current;

  // 开过 turn 的会话只读：chip 只写当前模式、点不动（判据与 host 拒绝切换读的是同一个投影）。
  if (editable === false) {
    return (
      <SeatButton
        disabled
        title={t("lockedHint")}
        icon={<IconAgentPresetOutlineRegular />}
        label={label}
      />
    );
  }

  return (
    <Menu
      open={open}
      onClose={() => {
        setOpen(false);
      }}
      items={roster.modes.map((mode) => ({
        id: mode.id,
        label: (
          <Stack gap={2}>
            <Text size="md">{mode.name}</Text>
            <Text size="sm" tone="tertiary">
              {mode.description ?? t("noDescription")}
            </Text>
          </Stack>
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
      anchor={
        <SeatButton
          aria-haspopup="menu"
          aria-expanded={open}
          title={error ?? t("seatHint")}
          disabled={busy}
          icon={<IconAgentPresetOutlineRegular />}
          label={label}
          chevron={<IconChevronDownOutlineRegular />}
          onClick={() => {
            setOpen((value) => !value);
          }}
        />
      }
    />
  );
}
