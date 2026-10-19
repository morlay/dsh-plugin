// 文件系统契约：令牌按服务语义命名（上游注册名 `fs`）。
import type { FileSystem as FileSystemService } from "@deepseek-ai/dsh-fs";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

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

  abstract readonly writeText: FileSystemService["writeText"];

  abstract readonly editText: FileSystemService["editText"];
}

