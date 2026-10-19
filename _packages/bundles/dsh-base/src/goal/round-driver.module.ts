import { Module, type ProviderList } from "@morlay/zephyr";
import { GoalRoundDriver } from "./round-driver.service.ts";

const providers = (): ProviderList => [GoalRoundDriver];

@Module({ providers: providers() })
export class GoalRoundDriverModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
