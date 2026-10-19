import { Module, type ProviderList } from "@morlay/zephyr";
import { SkillFilesystem } from "./filesystem.service.ts";

const providers = (): ProviderList => [SkillFilesystem];

@Module({ providers: providers() })
export class SkillFilesystemModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
