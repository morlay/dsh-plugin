// 技能注册表契约：令牌按服务语义命名（上游注册名 `skill`）。
import type SkillRegistryService from "@deepseek-ai/dsh-skill";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SkillRegistry` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.skill.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`；
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SkillCovered = AssertTrue<AssertCovered<SkillRegistryService, Skill>>;

@Injectable()
export abstract class Skill {
  abstract readonly registerProvider: SkillRegistryService["registerProvider"];

  abstract readonly get: SkillRegistryService["get"];

  abstract readonly list: SkillRegistryService["list"];

  abstract readonly register: SkillRegistryService["register"];

  abstract readonly snapshot: SkillRegistryService["snapshot"];
}

