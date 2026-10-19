import { Module } from "@morlay/zephyr";
import { UiSkill } from "./skill.client.service.ts";

@Module({ providers: [UiSkill] })
export class SkillClientModule {}
