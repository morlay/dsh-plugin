// 工作目录契约：令牌按服务语义命名（上游注册名 `workingDirectory`）。
import type { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory";
import { Injectable } from "@morlay/zephyr";

interface WorkingDirectoryFace {
  readonly get: WorkingDirectoryService["get"];
  readonly ensure: WorkingDirectoryService["ensure"];
  readonly set: WorkingDirectoryService["set"];
}

@Injectable()
export abstract class WorkingDirectory implements WorkingDirectoryFace {
  abstract readonly get: WorkingDirectoryFace["get"];

  abstract readonly ensure: WorkingDirectoryFace["ensure"];

  abstract readonly set: WorkingDirectoryFace["set"];
}
