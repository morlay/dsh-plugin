import { provide } from "@morlay/zephyr";
import { CompactionBasic } from "./basic.service.ts";
import { ImageOffload } from "./image-offload.service.ts";
import { ToolResultPruner } from "./tool-result-pruner.service.ts";

// 压缩域的三条行：主体压缩、图片外置、工具结果裁剪——都是「把大的东西变小」，属同一个域。
export const provideCompactionBasic = provide([CompactionBasic, ImageOffload, ToolResultPruner]);
