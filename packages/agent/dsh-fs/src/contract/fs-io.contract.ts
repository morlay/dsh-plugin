// 文件读写的**结果形状**（上游 `@deepseek-ai/dsh-fs`）：写面与改面各自回什么。
//
// 契约面只放两端共用、进程内端口要用的类型；实现（`LocalFileSystem`）在包根。
// `FsVersion` 是品牌类型**与**同名铸造函数（两用），所以按值转出。
export type {
  FsDeleteOutcome,
  FsEditOutcome,
  FsEditRequest,
  FsMoveOutcome,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from "@deepseek-ai/dsh-fs";
export { FsVersion } from "@deepseek-ai/dsh-fs";
