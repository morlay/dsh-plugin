import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { Module, type ProviderList } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
import { SessionPersistenceJsonl } from "./jsonl.service.ts";

const providers = (): ProviderList => [SessionPersistenceJsonl.withConfig({ root: jsExpr(() => dshHomePath("sessions")) })];

@Module({ providers: providers() })
export class SessionPersistenceJsonlModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
