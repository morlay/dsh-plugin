// 文件系统契约：令牌按服务语义命名（上游注册名 `fs`）。
import type { FileSystem as FileSystemService } from "@deepseek-ai/dsh-fs";
import { Injectable } from "@morlay/zephyr";

interface FileSystemFace {
  readonly watch: FileSystemService["watch"];
  readonly resolve: FileSystemService["resolve"];
  readonly processPath: FileSystemService["processPath"];
  readonly fileUrl: FileSystemService["fileUrl"];
}

@Injectable()
export abstract class FileSystem implements FileSystemFace {
  abstract readonly watch: FileSystemFace["watch"];

  abstract readonly resolve: FileSystemFace["resolve"];

  abstract readonly processPath: FileSystemFace["processPath"];

  abstract readonly fileUrl: FileSystemFace["fileUrl"];
}
