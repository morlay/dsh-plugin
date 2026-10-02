// Shared IconActions chrome for user and assistant messages: copy
// live, optional branch wiring, and an optional date-aware clock.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  IconBranchOutlineRegular,
  IconButton,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  IconEditOutlineRegular,
  IconRefreshOutlineRegular,
  Row,
  TimeLabel,
  Tooltip,
  VisuallyHidden,
  writeClipboard,
} from "@morlay/dsh-client-ui-primitives/client";
import type { ChatViewSlotProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import { formatMessageClock } from "./message-chrome.ts";
import { useCalendarDay } from "./use-calendar-day.ts";

export interface MessageIconActionsProps {
  text: string;

  time?: number | undefined;

  clock: "start" | "end";

  onBranch?: (() => void) | undefined;

  branchUnavailable?: boolean | undefined;

  className?: string | undefined;

  extraActions?: ReactNode;

  onEdit?: (() => void) | undefined;

  onRetry?: (() => void) | undefined;

  t: ChatViewSlotProps["t"];
}

export function MessageIconActions({
  text,
  time,
  clock,
  onBranch,
  branchUnavailable = false,
  className,
  extraActions,
  onEdit,
  onRetry,
  t,
}: MessageIconActionsProps) {
  const day = useCalendarDay();
  const reasonId = useId();
  // Same success chrome as CodeBlock: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  const [copied, setCopied] = useState(false);
  const copyPending = useRef(false);
  const copyTimer = useRef<number | null>(null);
  const copyEpoch = useRef(0);
  useEffect(
    () => () => {
      copyEpoch.current += 1;
      copyPending.current = false;
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    [],
  );
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return;
    const epoch = copyEpoch.current;
    copyPending.current = true;
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return;
      copyPending.current = false;
      if (!ok) return;
      setCopied(true);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null;
        setCopied(false);
      }, 1000);
    });
  }, [copied, text]);
  // 只剩时钟：耗时 / TTFT / tok-s 的读数在 0.1.7 已不属于消息 chrome（上游把它们收进
  // 会话统计弹窗与轮次过程节点），上游那套聊天文案表也不再提供这三个 key。
  const clockEl =
    time === undefined ? null : (
      <TimeLabel data-time-label="">{formatMessageClock(time, t, day)}</TimeLabel>
    );
  return (
    <Row gap={10} fixed data-time-hover-root="" {...(className === undefined ? {} : { className })}>
      {clock === "start" ? clockEl : null}
      <Tooltip label={copied ? t("copied" as never) : t("copy" as never)} side="bottom">
        <IconButton shape="circle"
          label={copied ? t("copied" as never) : t("copy" as never)}
          onClick={onCopy}
        >
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </IconButton>
      </Tooltip>
      {extraActions}
      {onEdit !== undefined && (
        <Tooltip label="编辑" side="bottom">
          <IconButton shape="circle"
            label="编辑"
            onClick={onEdit}
          >
            <IconEditOutlineRegular />
          </IconButton>
        </Tooltip>
      )}
      {onRetry !== undefined && (
        <Tooltip label="重试此回合" side="bottom">
          <IconButton shape="circle"
            label="重试此回合"
            onClick={onRetry}
          >
            <IconRefreshOutlineRegular />
          </IconButton>
        </Tooltip>
      )}
      {onBranch !== undefined && (
        <Tooltip
          label={branchUnavailable ? t("message.branchUnavailable") : t("message.branch")}
          side="bottom"
        >
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <IconButton shape="circle"
            label={t("message.branch")}
            aria-disabled={branchUnavailable || undefined}
            aria-describedby={branchUnavailable ? reasonId : undefined}
            data-unavailable={branchUnavailable || undefined}
            onClick={branchUnavailable ? undefined : onBranch}
          >
            <IconBranchOutlineRegular />
          </IconButton>
        </Tooltip>
      )}
      {onBranch !== undefined && branchUnavailable && (
        <VisuallyHidden id={reasonId}>{t("message.branchUnavailable")}</VisuallyHidden>
      )}
      {clock === "end" ? clockEl : null}
    </Row>
  );
}
