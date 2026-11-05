// composer 里的模式 chip：本包在会话里唯一的面（点开是模式清单）。
// 选择只在会话开始**之前**有效（那段历史属于某个模式的工具与提示词），所以 chip 有两个形态：空白期是
// 选择器，开过 turn 之后只读。判据是宿主的 `editableOf`（与服务端拒绝切换读的是同一份事实）。
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
import { ConversationInputLeftSlot } from "./session-mode-slots.ts";
import { SessionModeStore } from "./session-mode.store.ts";
import { useRoster } from "./use-roster.ts";
import { viewPropsOf } from "./view-props.ts";

/** composer 里的模式选择器。 */
@SlotView()
export class SessionModeSeatView extends ConversationInputLeftSlot {
  private readonly store = inject(SessionModeStore);

  render(): ReactNode {
    return <SessionModeSeat sessionId={viewPropsOf(this.viewProps).sessionId} store={this.store} />;
  }
}

function SessionModeSeat({
  sessionId,
  store,
}: {
  readonly sessionId: string | undefined;
  readonly store: SessionModeStore;
}): ReactNode {
  const roster = useRoster(store);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [editable, setEditable] = useState(true);

  if (roster === undefined) return null;

  const current = selected ?? roster.default;
  const chosen = roster.modes.find((mode) => mode.id === current);
  const label = chosen?.name ?? current;

  // 开过 turn 的会话只读：chip 只写当前模式、点不动。
  if (!editable) {
    return (
      <SeatButton
        disabled
        title="这个会话已经开始：换模式请新开一个会话"
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
              {mode.description ?? "（无说明）"}
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
          .then((mode) => {
            setSelected(mode);
            setEditable(false);
          })
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
          title={error ?? "选择这个会话的模式"}
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
