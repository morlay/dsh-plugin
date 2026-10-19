import { FileSystem } from "@morlay/dsh-base/fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapApplication } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";
import { DshBaseModule } from "../zephyr.module.ts";
import { Llm } from "@morlay/dsh-base/llm";
import { CompactionBasic } from "@morlay/dsh-base/compaction";
import { SessionStore } from "@morlay/dsh-base/session";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import { SessionProjectionCache } from "@morlay/dsh-base/session-projection";
import { TokenMeter } from "@morlay/dsh-base/token-meter";
import { WorkflowPtc } from "@morlay/dsh-base/workflow";
import { Agents, AgentDefaultModel, AgentLoop, Authorization, Credentials, DeepseekAccount, SystemPrompt, UserQuestions } from "@morlay/dsh-base/agent";
import { Commands } from "@morlay/dsh-base/commands";
import { Goal } from "@morlay/dsh-base/goal";
import { PlanMode } from "@morlay/dsh-base/plan-mode";
import { Skill } from "@morlay/dsh-base/skill";
import { McpResources, SpillLocal, ToolResultPruner, Tools } from "@morlay/dsh-base/tool";
import { Approval, ShellExecutor, Permission, Sandbox, SandboxPolicy, ShellEnv, Subprocess, WorkingDirectory } from "@morlay/dsh-base/sandbox";
import { Storage } from "@morlay/dsh-base/storage";
import { Attachments, Jobs, PtcRuntime, Timer } from "@morlay/dsh-base/runtime";
import { Otel, SessionTelemetryOtel } from "@morlay/dsh-base/telemetry";
import { RemoteAccess, Typert, TypertGateway } from "@morlay/dsh-base/typert";
import { Web } from "@morlay/dsh-base/web";

describe("DshBaseModule 无 patch 启动", () => {
  it("核心服务与 llm-pi-ai 都能由 Module 直接装配", { timeout: 20000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-base-"));
    process.env.DSH_HOME = home;
    const app = await bootstrapApplication({
      providers: [DshBaseModule],
      timeoutMs: 5000,
    });

    try {
      expect(app.get(Llm)).toBeDefined();
      expect(app.get(SessionStore)).toBeDefined();
      expect(app.get(Tools)).toBeDefined();
      expect(app.get(Agents)).toBeDefined();
      expect(app.get(SystemPrompt)).toBeDefined();
      expect(app.get(Timer)).toBeDefined();
      expect(app.get(Storage)).toBeDefined();
      expect(app.get(SessionProjections)).toBeDefined();
      expect(app.get(Credentials)).toBeDefined();
      expect(app.get(Attachments)).toBeDefined();
      expect(app.get(Jobs)).toBeDefined();
      expect(app.get(Skill)).toBeDefined();
      expect(app.get(Commands)).toBeDefined();
      expect(app.get(Goal)).toBeDefined();
      expect(app.get(PlanMode)).toBeDefined();
      expect(app.get(UserQuestions)).toBeDefined();
      expect(app.get(AgentDefaultModel)).toBeDefined();
      expect(app.get(Authorization)).toBeDefined();
      expect(app.get(DeepseekAccount)).toBeDefined();
      expect(app.get(SessionProjectionCache)).toBeDefined();
      expect(app.get(TokenMeter)).toBeDefined();
      expect(app.get(CompactionBasic)).toBeDefined();
      expect(app.get(SpillLocal)).toBeDefined();
      expect(app.get(McpResources)).toBeDefined();
      expect(app.get(ToolResultPruner)).toBeDefined();
      expect(app.get(PtcRuntime)).toBeDefined();
      expect(app.get(Web)).toBeDefined();
      expect(app.get(AgentLoop)).toBeDefined();
      expect(app.get(WorkflowPtc)).toBeDefined();
      expect(app.get(Typert)).toBeDefined();
      expect(app.get(RemoteAccess)).toBeDefined();
      expect(app.get(TypertGateway)).toBeDefined();
      expect(app.get(SessionTelemetryOtel)).toBeDefined();
      expect(app.get(Subprocess)).toBeDefined();
      expect(app.get(Otel)).toBeDefined();
      expect(app.get(ShellEnv)).toBeDefined();
      expect(app.get(Approval)).toBeDefined();
      expect(app.get(Sandbox)).toBeDefined();
      expect(app.get(ShellExecutor)).toBeDefined();
      expect(app.get(Permission)).toBeDefined();
      expect(app.get(FileSystem)).toBeDefined();
      expect(app.get(WorkingDirectory)).toBeDefined();
      expect(app.get(SandboxPolicy)).toBeDefined();
    } finally {
      await app.dispose();
      delete process.env.DSH_HOME;
      await rm(home, { recursive: true, force: true });
    }
  });
});
