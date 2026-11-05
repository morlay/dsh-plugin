import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/load.ts";
import { CliError } from "../errors.ts";
import { tempWorkspace } from "../testing/index.ts";

const CONFIG = `export default {
  server: { entry: './src/server.ts' },
  client: { entry: './src/client/index.html' },
  desktop: { id: 'ai.deepseek.zephyr.custom-next', name: 'Zephyr Custom' },
  dataDir: 'xdg',
  build: { outDir: 'out' },
};
`;

describe("工作区配置", () => {
  it("把入口与产物路径绝对化", async () => {
    const workspace = await tempWorkspace({ "zephyr.config.ts": CONFIG });
    const resolved = await loadConfig({ cwd: workspace });
    expect(resolved.configFile).toBe(`${workspace}/zephyr.config.ts`);
    expect(resolved.serverEntry).toBe(`${workspace}/src/server.ts`);
    expect(resolved.clientEntry).toBe(`${workspace}/src/client/index.html`);
    expect(resolved.layout.root).toBe(`${workspace}/out`);
    expect(resolved.appName).toBe("Zephyr Custom");
  });

  it("没有配置就是错误，不回落（清单是唯一装配面）", async () => {
    const workspace = await tempWorkspace({});
    await expect(loadConfig({ cwd: workspace })).rejects.toThrowError(/没有找到 zephyr.config.ts/u);
    await expect(loadConfig({ cwd: workspace })).rejects.toBeInstanceOf(CliError);
  });

  it("缺 server.entry / client.entry 时指出缺哪个", async () => {
    const workspace = await tempWorkspace({
      "zephyr.config.ts": `export default { server: { entry: './s.ts' } };`,
    });
    await expect(loadConfig({ cwd: workspace })).rejects.toThrowError(/client.entry/u);
  });
});
