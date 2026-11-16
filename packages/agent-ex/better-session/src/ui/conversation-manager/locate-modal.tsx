// 事件定位弹窗：会话内按文本 / 类型 / 角色 / 工具名 / 时间定位事件。
//
// 只读：定位不写库、不改日志（修法是 `repair-modal` 那条入口）。命中只回 seq、行上的维度与命中片段，
// 所以坏会话也能靠它先看坏在哪一行。
import { Button, Input, Modal, Stack, Text } from "@morlay/zephyr-ui";
import { useState } from "react";
import type { ReactNode } from "react";
import type { SessionLocateValue } from "@morlay/better-session/endpoint";
import { Feedback } from "../shared/feedback.tsx";
import type { ConversationLocateQuery } from "./conversation-manager.controller.ts";
import type { ConversationManagerTranslate } from "./locales.ts";

// 目标会话：定位按会话身份发请求，页面只在这里带上它。
export interface LocateTarget {
  readonly id: string;
  readonly title: string;
}

export interface LocateModalProps {
  // 要定位的会话；null 表示弹窗关着。
  readonly target: LocateTarget | null;
  readonly onLocate: (
    sessionId: string,
    query: ConversationLocateQuery,
  ) => Promise<SessionLocateValue>;
  readonly describeFailure: (error: unknown) => string;
  readonly onClose: () => void;
  readonly t: ConversationManagerTranslate;
}

// 表单原文：时间两栏是 `datetime-local` 的原始字符串（本地时区），发请求前才换成毫秒。
interface LocateForm {
  readonly text: string;
  readonly type: string;
  readonly role: string;
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

const EMPTY_FORM: LocateForm = { text: "", type: "", role: "", name: "", from: "", to: "" };

// 时间栏 → 毫秒：空值与解析不出来的都不下推（不是「当成 0」）。
function timeOf(value: string): number | undefined {
  if (value === "") return undefined;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : undefined;
}

// 表单 → 端点条件：空栏不出现（不把「没填」变成一个等值条件）。
function queryOf(form: LocateForm): ConversationLocateQuery {
  const text = form.text.trim();
  const type = form.type.trim();
  const role = form.role.trim();
  const name = form.name.trim();
  const fromTime = timeOf(form.from);
  const toTime = timeOf(form.to);
  return {
    ...(text === "" ? {} : { text }),
    ...(type === "" ? {} : { types: [type] }),
    ...(role === "" ? {} : { role }),
    ...(name === "" ? {} : { name }),
    ...(fromTime === undefined ? {} : { fromTime }),
    ...(toTime === undefined ? {} : { toTime }),
  };
}

/**
 * 定位弹窗。
 * @param props - 目标会话、定位动作、失败文案与关闭入口。
 * @returns 弹窗。
 */
export function LocateModal({
  target,
  onLocate,
  describeFailure,
  onClose,
  t,
}: LocateModalProps): ReactNode {
  const [form, setForm] = useState<LocateForm>(EMPTY_FORM);
  const [result, setResult] = useState<SessionLocateValue | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const field = (key: keyof LocateForm) => ({
    value: form[key],
    onChange: (event: { currentTarget: { value: string } }) => {
      const value = event.currentTarget.value;
      setForm((previous) => ({ ...previous, [key]: value }));
    },
  });

  const run = (): void => {
    if (target === null) return;
    setBusy(true);
    setFailure(null);
    void onLocate(target.id, queryOf(form))
      .then(
        (value) => {
          setResult(value);
        },
        (error: unknown) => {
          setFailure(describeFailure(error));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={t("locate.title")}
      closeLabel={t("close")}
      description={t("locate.description")}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("confirmCancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-action="locate-run"
            disabled={busy}
            aria-busy={busy}
            onClick={run}
          >
            {busy ? t("locate.running") : t("locate.run")}
          </Button>
        </>
      }
    >
      <Stack gap={8}>
        <Text size="sm" tone="tertiary">
          {target?.title ?? ""}
        </Text>
        <Input {...field("text")} data-locate="text" aria-label={t("locate.text")} />
        <Input {...field("type")} data-locate="type" aria-label={t("locate.type")} />
        <Input {...field("role")} data-locate="role" aria-label={t("locate.role")} />
        <Input {...field("name")} data-locate="name" aria-label={t("locate.name")} />
        <input
          type="datetime-local"
          data-locate="from-time"
          aria-label={t("locate.fromTime")}
          {...field("from")}
        />
        <input
          type="datetime-local"
          data-locate="to-time"
          aria-label={t("locate.toTime")}
          {...field("to")}
        />
        {failure === null ? null : <Feedback tone="failure" source="locate" text={failure} />}
        {result === null ? null : (
          <div
            data-locate="results"
            data-locate-window={result.window.fromSeq + "-" + result.window.toSeq}
          >
            <Text size="sm" tone="tertiary">
              {t("locate.window", {
                from: result.window.fromSeq,
                to: result.window.toSeq,
                total: result.total,
              })}
            </Text>
            {result.items.length === 0 ? (
              <Text as="p" size="sm">
                {t("locate.empty")}
              </Text>
            ) : (
              <Stack as="ul" gap={4} plain>
                {result.items.map((item) => (
                  <li key={item.seq} data-locate-hit={item.seq}>
                    <Text size="sm" tone="tertiary" tabular>
                      {t("locate.hitSeq", { seq: item.seq })} · {item.type}
                      {item.role === null ? "" : " · " + item.role}
                      {item.name === null ? "" : " · " + item.name}
                    </Text>
                    <Text as="p" size="sm">
                      {item.snippet}
                    </Text>
                  </li>
                ))}
              </Stack>
            )}
          </div>
        )}
      </Stack>
    </Modal>
  );
}
