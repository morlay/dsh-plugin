import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionCheckpointPolicy } from "./checkpoint-policy.service.ts";

const providers = (): ProviderList => [SessionCheckpointPolicy];

@Module({ providers: providers() })
export class SessionCheckpointPolicyModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
