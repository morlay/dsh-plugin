import { Module, type ProviderList } from "@morlay/zephyr";
import { TypertDefault } from "./typert.service.ts";
import { RemoteAccessDefault } from "./remote-access.service.ts";
import { TypertGatewayDefault } from "./typert-gateway.service.ts";

const providers = (): ProviderList => [
  TypertDefault,
  RemoteAccessDefault,
  TypertGatewayDefault,
];

@Module({ providers: providers() })
export class TypertModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
