import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";

// 两条通用 MCP：`dsh-mcp-client` 用 stdio 分别起 `agent-browser mcp` 与 `agent-desktop mcp`，
// 工具以 `mcp__agent-browser__*` / `mcp__agent-desktop__*` 进模型目录。都是**宿主级**挂载——一个
// server 进程、所有会话共用；要每会话隔离就走 browser-use + 提供方那一套。
//
// 命令只写全局 bin 名：装没装由机器的 PATH 决定，不在这里钉绝对路径。`failOnStartupError` 保持
// 上游默认的 false——命令不存在时这一行照样激活、只是没有工具，宿主其余部分不受影响。
const ROWS: readonly unknown[] = [
  {
    insert: [
      {
        id: "mcp-agent-browser",
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          serverName: "agent-browser",
          transport: "stdio",
          command: "agent-browser",
          args: ["mcp"],
        },
      },
      {
        id: "mcp-agent-desktop",
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          serverName: "agent-desktop",
          transport: "stdio",
          command: "agent-desktop",
          args: ["mcp"],
        },
      },
    ],
  },
];

// patch 真源：生成物是包根那份 `cordis.patch.yml`，build 时由插件重写。
export const patch: PatchBundleOptions = {
  from: import.meta.url,
  rows: () => ROWS,
};

// 渲染生成物文本（测试拿它与入库那份比对）。
export const render = (): Promise<string> => renderPatch(patch);

export default defineConfig({
  plugins: [cordisPlugin(), bundlePatch(patch)],
});
