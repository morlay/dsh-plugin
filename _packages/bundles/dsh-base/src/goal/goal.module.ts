import { Module, type ProviderList } from "@morlay/zephyr";
import { GoalDefault } from "./goal.service.ts";

const providers = (): ProviderList => [GoalDefault];

@Module({ providers: providers() })
export class GoalModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
