import { Module, type ProviderList } from "@morlay/zephyr";
import { CommandGoal } from "./command.service.ts";

const providers = (): ProviderList => [CommandGoal];

@Module({ providers: providers() })
export class CommandGoalModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
