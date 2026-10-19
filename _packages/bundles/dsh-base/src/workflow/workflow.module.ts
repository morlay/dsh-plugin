import { Module, type ProviderList } from "@morlay/zephyr";
import { WorkflowPtc } from "./workflow-ptc.service.ts";

const providers = (): ProviderList => [
  WorkflowPtc.withConfig({ provider: "spawn" }),
];

@Module({ providers: providers() })
export class WorkflowModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
