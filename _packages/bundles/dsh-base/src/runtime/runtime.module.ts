import { Module, type ProviderList } from "@morlay/zephyr";
import { TimerDefault } from "./timer.service.ts";
import { AttachmentsDefault } from "./attachments.service.ts";
import { JobsDefault } from "./jobs.service.ts";
import { PtcRuntimeDefault } from "./ptc-runtime.service.ts";

const providers = (): ProviderList => [TimerDefault, AttachmentsDefault, JobsDefault, PtcRuntimeDefault];

@Module({ providers: providers() })
export class RuntimeModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
