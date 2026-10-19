import { Module } from "@morlay/zephyr";
import { TelemetryModule } from "./telemetry/index.ts";
import { JobsModule } from "./jobs/index.ts";
import { TerminalModule } from "./terminal/index.ts";
import { AccountModule } from "./account/index.ts";
import { ConnectionModule } from "./connection/index.ts";
import { SubagentModule } from "./subagent/index.ts";
import { FeedbackModule } from "./feedback/index.ts";
import { SessionModule } from "./session/index.ts";
import { OpenInAppModule } from "./open-in-app/index.ts";
import { WorkspaceModule } from "./workspace/index.ts";
import { ReferenceModule } from "./reference/index.ts";
import { PluginInventoryModule } from "./plugin-inventory/index.ts";
import { ScheduleModule } from "./schedule/index.ts";
import { CordisModule } from "./cordis/index.ts";
import { WebModule } from "./web/index.ts";
import { DevContextModule } from "./dev-context/index.ts";
import { OfficeModule } from "./office/index.ts";
import { FileUploadModule } from "./file-upload/index.ts";
import { AgentPresetModule } from "./agent-preset/index.ts";
import { ApiRemotesModule } from "./api-remotes/api-remotes.module.ts";
import { SettingsFormsModule } from "./settings/settings.module.ts";

@Module({ imports: [SettingsFormsModule, TelemetryModule, SubagentModule, FeedbackModule, SessionModule, OpenInAppModule, WorkspaceModule, ReferenceModule, PluginInventoryModule, JobsModule, TerminalModule, AccountModule, ConnectionModule, ScheduleModule, CordisModule, WebModule, DevContextModule, OfficeModule, FileUploadModule, AgentPresetModule, ApiRemotesModule, SettingsFormsModule] })
export class DshWebAppHostModule {}
