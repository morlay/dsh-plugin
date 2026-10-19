import { Module, type ProviderList } from "@morlay/zephyr";
import { SessionQuerySqlite } from "./sqlite.service.ts";

const providers = (): ProviderList => [SessionQuerySqlite.withConfig({ path: ":memory:", openAt: "never" })];

@Module({ providers: providers() })
export class SessionQuerySqliteModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
