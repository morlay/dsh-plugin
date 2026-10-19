import { Module } from "@morlay/zephyr";
import { PluginInventory } from "./plugin-inventory.service.ts";

@Module({ providers: [PluginInventory] })
export class PluginInventoryModule {}
