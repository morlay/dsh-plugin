// 布局契约（上游 `dsh-client-ui-layout` 的 `layout` 服务）：面板选择与列状态。
import type { ILayout } from "@deepseek-ai/dsh-client-ui-layout/client";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class Layout {
  abstract readonly panelInfo: ILayout["panelInfo"];

  abstract readonly toggleSidebar: ILayout["toggleSidebar"];
}
