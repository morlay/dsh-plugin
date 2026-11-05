import { provide } from "@morlay/zephyr";
import { ToolBash } from "./bash.tool.ts";
import { ToolFs } from "./fs.tool.ts";
import { ToolFsSearch } from "./fs-search.tool.ts";

// 文件与检索两条工具行（`read`/`write`/`edit`、`glob`/`grep`）。
//
// `sampleOverCapGlobResults` 是上游**必填**的部署选择（超上限时是否抽样），没有默认值：
// 取 `false`（截断即如实报告），与上游 `base` / `web-app` 补丁里的配置一致。
export const provideFsTools = provide([
  ToolBash,
  ToolFs,
  { provide: ToolFsSearch, config: { sampleOverCapGlobResults: false } },
]);
