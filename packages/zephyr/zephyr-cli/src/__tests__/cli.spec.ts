import { describe, expect, it } from "vitest";
import { runCli } from "../run.ts";
import { memoryStream, tempWorkspace } from "../testing/index.ts";

/**
 * 造一个带插件的临时工作区（插件用绝对路径 import：临时目录里解析不到本包的包名）。
 * @returns 工作区绝对路径。
 */
async function workspaceWithEcho(): Promise<string> {
  const echo = new URL("../testing/echo-command.ts", import.meta.url).pathname;
  return tempWorkspace({
    "zephyr.config.ts": [
      `const { EchoCommand } = await import('${echo}');`,
      "export default {",
      "  server: { entry: './src/server.ts' },",
      "  client: { entry: './src/client/index.tsx' },",
      "  desktop: { id: 'ai.example.echo', name: 'Echo' },",
      "  plugins: [EchoCommand],",
      "};",
    ].join("\n"),
    "src/server.ts": "export default [];",
    "src/client/index.tsx": "export {};",
  });
}

describe("CLI 内核", () => {
  it("配置里的插件命令进树、能跑，退出码透传", async () => {
    const workspace = await workspaceWithEcho();
    const stdout = memoryStream();
    const stderr = memoryStream();
    const code = await runCli(["echo", "hi", "--loud"], {
      cwd: workspace,
      stdout: stdout.write,
      stderr: stderr.write,
    });
    expect(stderr.lines).toEqual([]);
    expect(code).toBe(7);
    expect(stdout.lines.join("\n")).toContain("echo echo hi!");
  });

  it("裸调用打根帮助，列出核心命令与插件命令", async () => {
    const workspace = await workspaceWithEcho();
    const stdout = memoryStream();
    const code = await runCli([], { cwd: workspace, stdout: stdout.write, stderr: () => {} });
    const text = stdout.lines.join("\n");
    expect(code).toBe(0);
    for (const name of ["dev", "build", "preview", "echo"]) expect(text).toContain(name);
  });

  it("命令帮助由 schema 生成，含全局与命令自己的选项", async () => {
    const workspace = await workspaceWithEcho();
    const stdout = memoryStream();
    const code = await runCli(["echo", "--help"], {
      cwd: workspace,
      stdout: stdout.write,
      stderr: () => {},
    });
    const text = stdout.lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("用法: zephyr echo");
    expect(text).toContain("--loud");
    expect(text).toContain("--data-dir");
  });

  it("未知命令是用法错误（退出码 2）", async () => {
    const workspace = await workspaceWithEcho();
    const stderr = memoryStream();
    const stdout = memoryStream();
    const code = await runCli(["nope"], {
      cwd: workspace,
      stdout: stdout.write,
      stderr: stderr.write,
    });
    expect(code).toBe(2);
    expect(stderr.lines.join("\n")).toContain("未知命令");
  });

  it("没有配置就退出 1，并指出缺的是哪个文件", async () => {
    const workspace = await tempWorkspace({});
    const stderr = memoryStream();
    const code = await runCli(["dev"], { cwd: workspace, stdout: () => {}, stderr: stderr.write });
    expect(code).toBe(1);
    expect(stderr.lines.join("\n")).toContain("zephyr.config.ts");
  });

  it("preview 在缺产物时报错（只吃已有产物）", async () => {
    const workspace = await workspaceWithEcho();
    const stderr = memoryStream();
    const code = await runCli(["preview"], {
      cwd: workspace,
      stdout: () => {},
      stderr: stderr.write,
    });
    expect(code).toBe(1);
    expect(stderr.lines.join("\n")).toContain("zephyr build");
  });
});
