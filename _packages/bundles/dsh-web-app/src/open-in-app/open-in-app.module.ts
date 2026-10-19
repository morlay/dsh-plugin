import { Module } from "@morlay/zephyr";
import { DirectoryPicker, OpenInApp } from "./open-in-app.service.ts";

@Module({ providers: [OpenInApp.withConfig({ "probeTimeoutMs": 10000, "iconTimeoutMs": 10000, "launchWatchMs": 1000 }), DirectoryPicker] })
export class OpenInAppModule {}
