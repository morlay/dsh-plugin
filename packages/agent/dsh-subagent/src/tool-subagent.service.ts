// 子代理工具（纯实现行，不声明契约）：body 在 `ToolSubagentBase`，这里只给这条行一个自己的类身份
// （`withConfig` 的去重键就是它，见基类注释）。
import { Injectable } from "@morlay/zephyr";
import { ToolSubagentBase } from "./tool-subagent.base.ts";

@Injectable()
export class ToolSubagent extends ToolSubagentBase {}
