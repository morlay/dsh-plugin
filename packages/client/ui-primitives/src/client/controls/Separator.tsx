// 分隔细线：浮层里"标题与内容之间"的那条（0.5px），间距由父级的 gap 给。

import type { ReactNode } from "react";
import css from "./Separator.module.css";

export function Separator(): ReactNode {
  return <div className={css.separator} aria-hidden />;
}
