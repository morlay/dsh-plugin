import { provide } from "@morlay/zephyr";
import { ToolWorkingDirectory } from "../working-directory.tool.ts";

// `working_directory` 工具行：`bash` 在 `@morlay/dsh-shell`、`read`/`write`/`edit` 与 `glob`/`grep` 在
// `@morlay/dsh-sandbox`（各自的能力域）；这条要的是工作目录，而工作目录已是 agent 的核心能力。
export const provideEnvTools = provide([ToolWorkingDirectory]);
