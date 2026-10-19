import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { ToolBash } from "./tool-bash.service.ts";
import { ToolFs } from "./tool-fs.service.ts";
import { ToolFsSearch } from "./tool-fs-search.service.ts";
import { ToolWorkingDirectory } from "./tool-working-directory.service.ts";

// 环境域的四条工具行：`bash` / `read` `write` `edit` / `glob` `grep` / `working_directory`。
// 工具定义在上游插件里；本包只把 shell、沙箱文件系统、工作目录交给它们。
//
// `sampleOverCapGlobResults` 是上游**必填**的部署选择（超上限时是否抽样），没有默认值：
// 取 `false`（截断即如实报告），与上游 `base` / `web-app` 补丁里的配置一致。
const providers = (): ProviderList => [
  ToolBash,
  ToolFs,
  configure(ToolFsSearch, { sampleOverCapGlobResults: false })([ToolFsSearch]),
  ToolWorkingDirectory,
];

export const provideEnvTool = provide(providers());
