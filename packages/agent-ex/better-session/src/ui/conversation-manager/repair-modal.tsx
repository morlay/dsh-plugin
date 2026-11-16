// 修复弹窗：坏会话的两个日志修法（丢坏尾部 / 整段重写）。
//
// 删除不在这里：那是既有的删除入口与守卫（已归档、非运行中），修法不重复造一个。
import { Button, Modal, Stack, Text } from "@morlay/zephyr-ui";
import type { ReactNode } from "react";
import type { SessionRepairAction } from "@morlay/better-session/endpoint";
import type { ConversationManagerTranslate } from "./locales.ts";

export interface RepairModalProps {
  // 要修的会话标题；null 表示弹窗关着。
  readonly title: string | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onAction: (action: SessionRepairAction) => void;
  readonly t: ConversationManagerTranslate;
}

/**
 * 修复入口的确认弹窗。
 * @param props - 目标会话、在途、取消与选中的修法。
 * @returns 弹窗。
 */
export function RepairModal({ title, busy, onCancel, onAction, t }: RepairModalProps): ReactNode {
  return (
    <Modal
      open={title !== null}
      onClose={onCancel}
      title={t("repair.title")}
      closeLabel={t("close")}
      tone="warning"
      description={t("repair.description")}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            {t("confirmCancel")}
          </Button>
          <Button
            variant="primary"
            tone="danger"
            data-tone="danger"
            disabled={busy}
            data-action="repair-drop-tail"
            onClick={() => {
              onAction("drop-tail");
            }}
          >
            {t("repair.dropTail")}
          </Button>
          <Button
            variant="primary"
            tone="danger"
            data-tone="danger"
            disabled={busy}
            data-action="repair-rewrite"
            onClick={() => {
              onAction("rewrite");
            }}
          >
            {t("repair.rewrite")}
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Text size="sm" tone="tertiary">
          {title ?? ""}
        </Text>
      </Stack>
    </Modal>
  );
}
