// 统一反馈面：动作与取数的结果共用一套呈现——成功是 `role="status"`、失败是 `role="alert"`，
// 可重试的失败带同一个重试入口，长任务在途带 `aria-busy`。列表、统计与消息行都从这里取，
// 不再各自写 role、颜色与重试按钮。
import { Button } from "@morlay/zephyr-ui";
import type { ReactNode } from "react";
import css from "./feedback.module.css";

// 反馈的两种色调：成功 / 在途的提示，以及失败的原因。
export type FeedbackTone = "notice" | "failure";

export interface FeedbackProps {
  // `notice` 落在 `role="status"`，`failure` 落在 `role="alert"`。
  tone: FeedbackTone;
  text: string;
  // 失败的重试入口；不可重试时不给。
  retry?: { readonly label: string; readonly onRetry: () => void } | undefined;
  // 反馈来自哪一处：写成 `data-notice` / `data-failure` 的值，供沟通与 e2e 定位。
  source?: string | undefined;
  // 在途（长任务的阶段提示）：给 `aria-busy`。
  busy?: boolean | undefined;
  className?: string | undefined;
}

export function Feedback({
  tone,
  text,
  retry,
  source,
  busy = false,
  className,
}: FeedbackProps): ReactNode {
  const marker =
    source === undefined
      ? {}
      : tone === "notice"
        ? { "data-notice": source }
        : { "data-failure": source };
  return (
    <div
      className={
        tone === "failure"
          ? [css.feedback, css.failure, className].filter(Boolean).join(" ")
          : [css.feedback, className].filter(Boolean).join(" ")
      }
      role={tone === "notice" ? "status" : "alert"}
      {...(busy ? { "aria-busy": "true" } : {})}
      {...marker}
    >
      <p className={css.text}>{text}</p>
      {retry === undefined ? null : (
        <Button variant="outline" size="sm" onClick={retry.onRetry}>
          {retry.label}
        </Button>
      )}
    </div>
  );
}
