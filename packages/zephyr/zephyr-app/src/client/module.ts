// client 链的装配顺序：提供方在前（Connection → Typert → Remote → ConfigForms → Slots → Locale →
// Shortcuts → Theme → Layout）。
import { Module } from "@morlay/zephyr";
import { ClientConnectionModule } from "./connection/index.ts";
import { ClientTypertModule } from "./typert/index.ts";
import { RemoteModule } from "./remote/index.ts";
import { ConfigFormsModule } from "./settings/index.ts";
import { RendererModule } from "./renderer/renderer.module.ts";
import { LocaleModule } from "./locale/index.ts";
import { ShortcutsModule } from "./shortcuts/index.ts";
import { ThemeModule } from "./theme/index.ts";
import { LayoutModule } from "./layout/index.ts";

@Module({
  imports: [
    ClientConnectionModule,
    ClientTypertModule,
    RemoteModule,
    ConfigFormsModule,
    RendererModule,
    LocaleModule,
    ShortcutsModule,
    ThemeModule,
    LayoutModule,
  ],
})
export class ClientChainModule {}
