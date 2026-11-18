import { provide } from "@morlay/zephyr";
import { WorkingDirectoryDefault } from "../working-directory.service.ts";

/**
 * 部署默认目录：清单里**不写死**值——缺省由 `WorkingDirectoryDefault` 从 `AppEnv` 取
 * （环境事实只有一个来源，见 `WorkingDirectoryConfig.defaultDirectory`）。
 *
 * 装配位置**这一票不动**（仍在应用根）：它内部按会话 header 的 cwd 分层。按 scope 装配要连着一串
 * 消费方（工具行、指令行、子代理注册表）一起量，见设计记录的「迁移面」。
 *
 * 装配面要换值：`provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory }))`
 * ——feature 与清单合并后显式给的那个值优先。
 */
export const provideWorkingDirectory = provide([WorkingDirectoryDefault]);
