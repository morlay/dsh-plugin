// 体检报告：只把不一致项列出来（kind / subject / detail）；修法在会话行上，报告不提供修复按钮。
//
// 报告的读法：`ok` 为假时逐条列出；每条的 `data-issue` 是检查项，页面上看得到「哪一项、哪个会话、
// 差多少」，不用去翻日志。
import { Stack, Text } from "@morlay/zephyr-ui";
import type { ReactNode } from "react";
import type { SessionConsistencyValue } from "@morlay/session-rdb/endpoint";
import { Feedback } from "../shared/feedback.tsx";
import type { ConversationManagerTranslate } from "./locales.ts";

export interface ConsistencyPanelProps {
  // 最近一次体检的报告；还没体检过是 null。
  readonly report: SessionConsistencyValue | null;
  readonly loading: boolean;
  readonly t: ConversationManagerTranslate;
}

/**
 * 体检结果的面板。
 * @param props - 报告、在途与翻译座。
 * @returns 在途提示 / 干净 / 不一致清单三态之一。
 */
export function ConsistencyPanel({ report, loading, t }: ConsistencyPanelProps): ReactNode {
  if (loading) {
    return <Feedback tone="notice" source="consistency" busy text={t("consistency.running")} />;
  }
  if (report === null) return null;
  if (report.ok) {
    return <Feedback tone="notice" source="consistency" text={t("consistency.ok")} />;
  }
  return (
    <section data-consistency="issues" aria-label={t("consistency.title")}>
      <Text size="sm" tone="tertiary">
        {t("consistency.issues", { count: report.issues.length })}
      </Text>
      <Stack as="ul" gap={2} plain>
        {report.issues.map((issue, index) => (
          <li key={issue.kind + ":" + issue.subject + ":" + String(index)} data-issue={issue.kind}>
            <Text size="sm" truncate>
              {issue.kind + " · " + issue.subject}
            </Text>
            <Text size="sm" tone="tertiary">
              {issue.detail}
            </Text>
          </li>
        ))}
      </Stack>
    </section>
  );
}
