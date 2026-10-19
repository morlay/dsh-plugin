// 技能注册表契约：令牌按服务语义命名（上游注册名 `skill`）。
import type SkillRegistry from "@deepseek-ai/dsh-skill";
import { Injectable } from "@morlay/zephyr";

interface SkillFace {
  readonly registerProvider: SkillRegistry["registerProvider"];
}

@Injectable()
export abstract class Skill implements SkillFace {
  abstract readonly registerProvider: SkillFace["registerProvider"];
}
