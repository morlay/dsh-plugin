// 目标契约：令牌按服务语义命名（上游注册名 `goal`）。
import type GoalService from "@deepseek-ai/dsh-goal";
import { Injectable } from "@morlay/zephyr";

interface GoalFace {
  readonly get: GoalService["get"];
  readonly create: GoalService["create"];
  readonly disarm: GoalService["disarm"];
}

@Injectable()
export abstract class Goal implements GoalFace {
  abstract readonly get: GoalFace["get"];

  abstract readonly create: GoalFace["create"];

  abstract readonly disarm: GoalFace["disarm"];
}
