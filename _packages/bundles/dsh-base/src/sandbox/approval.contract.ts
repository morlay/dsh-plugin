// 用户批准契约：令牌按服务语义命名（上游注册名 `approval`）。
import type { ApprovalService } from "@deepseek-ai/dsh-user-approval";
import { Injectable } from "@morlay/zephyr";

interface ApprovalFace {
  readonly setPolicy: ApprovalService["setPolicy"];
  readonly overrideOf: ApprovalService["overrideOf"];
}

@Injectable()
export abstract class Approval implements ApprovalFace {
  abstract readonly setPolicy: ApprovalFace["setPolicy"];

  abstract readonly overrideOf: ApprovalFace["overrideOf"];
}
