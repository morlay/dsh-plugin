import { Module, type ProviderList } from "@morlay/zephyr";
import { SkillDefault } from "./skill.service.ts";

const providers = (): ProviderList => [SkillDefault];

@Module({ providers: providers() })
export class SkillModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
