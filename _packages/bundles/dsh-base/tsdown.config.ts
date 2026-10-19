import { join } from "node:path";
import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatch, patchPackagesOf } from "@local/devkit/patch";
import { renderModulePatch, rowsOf, type ModulePatchOptions } from "@local/zephyr-codegen";
import { DshBaseModule } from "./src/zephyr.module.ts";

const patch = {
  module: DshBaseModule,
  from: import.meta.url,
  // 官方行的 insert 名按上游 base patch 落，不在 Module 里写映射表。
  packageNameOfRow: (id: string): string | undefined =>
    patchPackagesOf(
      join(import.meta.dirname, "../../../vendor/deepseek-harness/packages/bundle/base/cordis.patch.yml"),
    ).get(id),
} satisfies ModulePatchOptions;

export const render = (): Promise<string> => renderModulePatch(patch);
export const sourceUrl: string = patch.from;

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    agent: "./src/agent/index.ts",
    commands: "./src/commands/index.ts",
    goal: "./src/goal/index.ts",
    feedback: "./src/feedback/index.ts",
    compaction: "./src/compaction/index.ts",
    "plan-mode": "./src/plan-mode/index.ts",
    skill: "./src/skill/index.ts",
    llm: "./src/llm/index.ts",
    loader: "./src/loader/index.ts",
    runtime: "./src/runtime/index.ts",
    sandbox: "./src/sandbox/index.ts",
    session: "./src/session/index.ts",
    "session-projection": "./src/session-projection/index.ts",
    "session-persistence": "./src/session-persistence/index.ts",
    "session-query": "./src/session-query/index.ts",
    "session-log": "./src/session-log/index.ts",
    "session-title": "./src/session-title/index.ts",
    "token-meter": "./src/token-meter/index.ts",
    storage: "./src/storage/index.ts",
    subagent: "./src/subagent/index.ts",
    telemetry: "./src/telemetry/index.ts",
    tool: "./src/tool/index.ts",
    typert: "./src/typert/index.ts",
    web: "./src/web/index.ts",
    "web-server": "./src/web-server/index.ts",
    connection: "./src/connection/index.ts",
    workflow: "./src/workflow/index.ts",
    workspace: "./src/workspace/index.ts",
    fs: "./src/fs/index.ts",
  },
  plugins: [cordisPlugin(), bundlePatch({ from: patch.from, rows: () => rowsOf(patch.module, patch) })],
});
