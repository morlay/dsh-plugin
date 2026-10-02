// 加载指示：官方那套没有这个原子（`StateDot` 是状态点、`TextShimmer` 是文字微光），
// 列表与设置面的「正在读」都用它。

import type { ReactNode } from "react";
import css from "./Spinner.module.css";

export interface SpinnerProps {
  // 无障碍名（转圈本身没有文字）。
  label: string;
}

export function Spinner({ label }: SpinnerProps): ReactNode {
  return <span className={css.spinner} role="status" aria-label={label} />;
}
