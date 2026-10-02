// 折叠行：官方 `DisclosureRow` + 两条本包固定的布局类（内容区撑开并允许收缩、标题行左右分列）。
//
// 官方那份把这两个类留成 `contentClassName` / `contentLayoutClassName` 供消费方覆盖——设置面上每次都要同样
// 两条，所以在这里定下来：业务只传标题、摘要与展开状态，不再传类。

import type { ComponentProps, ReactNode } from "react";
import { DisclosureRow as OfficialDisclosureRow } from "@deepseek-ai/dsh-client-ui-primitives";
import css from "./DisclosureRow.module.css";

export type DisclosureRowProps = ComponentProps<typeof OfficialDisclosureRow>;

export function DisclosureRow(props: DisclosureRowProps): ReactNode {
  return (
    <OfficialDisclosureRow
      contentClassName={css.content}
      contentLayoutClassName={css.contentLayout}
      {...props}
    />
  );
}
