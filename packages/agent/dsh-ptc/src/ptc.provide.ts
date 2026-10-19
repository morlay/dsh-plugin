import { provide, type ProviderList } from "@morlay/zephyr";
import { PtcRuntimeDefault } from "./ptc-runtime.service.ts";

const providers = (): ProviderList => [PtcRuntimeDefault];

export const providePtc = provide(providers());
