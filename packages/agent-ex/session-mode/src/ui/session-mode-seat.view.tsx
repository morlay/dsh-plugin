// composer 里的模式 chip：本包在会话里唯一的面（点开是模式清单）。
// 选择只在会话开始**之前**有效（那段历史属于某个模式的工具与提示词），所以 chip 有两个形态：空白期是
// 选择器，开过 turn 之后只读。判据是宿主的 `sessionModeEditable` 投影（与服务端拒绝切换读的是同一份事实）。
import { useState, type ReactNode } from "react";
import { inject } from "@morlay/zephyr";
import { SlotView } from "@morlay/zephyr-app/client";
import {
  IconAgentPresetOutlineRegular,
  IconChevronDownOutlineRegular,
  Menu,
  SeatButton,
  Stack,
  Text,
} from "@morlay/zephyr-ui";
import { zh, type SessionModeLocaleKey } from "./locales.ts";
import {
  SessionModeLocales,
  type SessionModeTranslate,
} from "./session-mode-locales.contribution.ts";
import { ConversationInputLeftSlot } from "./session-mode-slots.ts";
import { SessionModeStore } from "./session-mode.store.ts";
import { useRoster } from "./use-roster.ts";
import { viewPropsOf, type SessionModeViewProps } from "./view-props.ts";

// chip 与它下面那条错误：竖排、宽度跟着按钮走（composer 工具行里不撑开）。
const SEAT_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  alignItems: "flex-start",
} as const;

// 纯展示组件在测试里也是直接渲染的（不经容器），所以翻译座缺省取中文那份字典。
const fallbackTranslate: SessionModeTranslate = (key: SessionModeLocaleKey) => zh[key];

// 没有会话状态读面时（测试、没装会话行的宿主）：两路投影读不到，chip 按空白会话的缺省形态渲染。
const NO_SESSIONS: NonNullable<SessionModeViewProps["useSessions"]> = () => undefined;

// 从会话目录快照里读一条投影值（上游 `useSessions` 的 selector 入参）。
function projectionOf(
  snapshot: { byId: Record<string, { projectionValues?: Record<string, unknown> }> },
  sessionId: string | undefined,
  key: string,
): unknown {
  return sessionId === undefined ? undefined : snapshot.byId[sessionId]?.projectionValues?.[key];
}

/** composer 里的模式选择器。 */
@SlotView()
export class SessionModeSeatView extends ConversationInputLeftSlot {
  private readonly store = inject(SessionModeStore);

  private readonly locales = inject(SessionModeLocales);

  render(): ReactNode {
    const props = viewPropsOf(this.viewProps);
    return (
      <SessionModeSeat
        sessionId={props.sessionId}
        store={this.store}
        useSessions={props.useSessions}
        t={this.locales.t()}
      />
    );
  }
}

/** chip 的渲染本体（容器只负责注入，测试直接渲染它）。 */
export function SessionModeSeat({
  sessionId,
  store,
  useSessions,
  t = fallbackTranslate,
}: {
  readonly sessionId: string | undefined;
  readonly store: SessionModeStore;
  readonly useSessions?: SessionModeViewProps["useSessions"];
  readonly t?: SessionModeTranslate | undefined;
}): ReactNode {
  const roster = useRoster(store);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 两个会话事实都读投影（与服务端拒绝切换读同一份事实）：现在选的是哪个模式、还能不能换。
  const sessions = useSessions ?? NO_SESSIONS;
  const selected = sessions((snapshot) => projectionOf(snapshot, sessionId, "sessionMode")) as
    | string
    | undefined;
  const editable = sessions((snapshot) =>
    projectionOf(snapshot, sessionId, "sessionModeEditable"),
  ) as boolean | undefined;

  if (roster === undefined) return null;

  const current = selected ?? roster.default;
  const chosen = roster.modes.find((mode) => mode.id === current);
  const label = chosen?.name ?? current;

  // 开过 turn 的会话只读：chip 只写当前模式、点不动，并把原因说出来（不然用户以为坏了）。
  if (editable === false) {
    return (
      <div data-role="session-mode-seat" data-locked="true" style={SEAT_STYLE}>
        <SeatButton
          disabled
          title={t("lockedHint")}
          icon={<IconAgentPresetOutlineRegular />}
          label={label}
        />
      </div>
    );
  }

  return (
    <div data-role="session-mode-seat" style={SEAT_STYLE}>
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
          void store
            .select(sessionId, id)
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
      {/* 失败不能只藏在 tooltip 里：鼠标一移开就没人知道刚才那次点没生效。 */}
      {error === null ? null : (
        <div data-role="seat-error" role="alert">
          <Text as="p" size="sm" tone="danger">
            {`${t("seatFailed")}: ${error}`}
          </Text>
        </div>
      )}
    </div>
  );
}
