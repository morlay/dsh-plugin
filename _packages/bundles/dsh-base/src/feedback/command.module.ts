import { Module, type ProviderList } from "@morlay/zephyr";
import { CommandFeedback } from "./command.service.ts";

const providers = (): ProviderList => [CommandFeedback];

@Module({ providers: providers() })
export class CommandFeedbackModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
