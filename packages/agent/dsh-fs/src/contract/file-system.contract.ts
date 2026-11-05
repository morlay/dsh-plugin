// 文件系统契约：令牌按服务语义命名（上游注册名 `fs`）。
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";
import { FileSystem as FileSystemService } from "@deepseek-ai/dsh-fs";

// 能力词汇：文件面的失败类型与那一行的配置形状。消费方要 `instanceof FsError` 分派、要按 Config
// 配一行 fs 时从这里取，不必自己去引 `@deepseek-ai/dsh-fs` / `-fs-local`。
/** 文件操作的失败（带码的 `HarnessError`），消费方按它分派。 */
export { FsError } from "@deepseek-ai/dsh-fs";
/** 上游 fs 行（`LocalFileSystem`）的配置形状；装配面 `configure(...)` 时按它填。 */
export type { Config as FileSystemConfig } from "@deepseek-ai/dsh-fs-local";

/**
 * 契约面：上游 `FileSystem` 的**全部**公开成员。
 *
 * 成员一个都不能少——上游插件按 `ctx.fs.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type FileSystemCovered = AssertTrue<AssertCovered<FileSystemService, FileSystem>>;

// 令牌只承载语义，成员由上面那份 `Pick` 合并进来（同一组签名只写一遍）。
@Injectable()
export abstract class FileSystem {
  abstract readonly watch: FileSystemService["watch"];

  abstract readonly sandboxMode: FileSystemService["sandboxMode"];

  abstract readonly resolve: FileSystemService["resolve"];

  abstract readonly processPath: FileSystemService["processPath"];

  abstract readonly processPathFromHostPath: FileSystemService["processPathFromHostPath"];

  abstract readonly fileUrl: FileSystemService["fileUrl"];

  abstract readonly contains: FileSystemService["contains"];

  abstract readonly stat: FileSystemService["stat"];

  abstract readonly lstat: FileSystemService["lstat"];

  abstract readonly readText: FileSystemService["readText"];

  abstract readonly streamText: FileSystemService["streamText"];

  abstract readonly readBytes: FileSystemService["readBytes"];

  abstract readonly readByteRange: FileSystemService["readByteRange"];

  abstract readonly listDir: FileSystemService["listDir"];

  /** 按补丁改文件（上游新增的三条写面：改、删、移）。 */
  abstract readonly patchText: FileSystemService["patchText"];

  abstract readonly deleteFile: FileSystemService["deleteFile"];

  abstract readonly moveFile: FileSystemService["moveFile"];

  abstract readonly writeText: FileSystemService["writeText"];

  abstract readonly editText: FileSystemService["editText"];
}
