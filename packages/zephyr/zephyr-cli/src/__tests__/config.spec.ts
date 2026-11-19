import { describe, expect, it } from "vitest";
import { loadConfig } from "../config/load.ts";
import { CliError } from "../errors.ts";
import { tempWorkspace } from "../testing/index.ts";

const CONFIG = `export default {
  server: { entry: './src/server.ts', outputDir: 'out' },
  client: { entry: './src/client/index.html' },
  desktop: { id: 'ai.deepseek.zephyr.custom-next', name: 'Zephyr Custom' },
  dataDir: 'xdg',
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

  it("没写 server.outputDir 就落 target/<应用名>", async () => {
    const workspace = await tempWorkspace({
      "zephyr.config.ts": `export default {
  server: { entry: './src/server.ts' },
  client: { entry: './src/client/index.html' },
  desktop: { id: 'ai.deepseek.zephyr.demo', name: 'Demo' },
};
`,
    });
    const resolved = await loadConfig({ cwd: workspace });
    expect(resolved.layout.root).toBe(`${workspace}/target/Demo`);
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

describe("dev.hmr 的两半开关", () => {
  /** 一份只带 dev.hmr 配置的工作区（其余字段最小化）。 */
  const withHmr = (hmr: string): string => `export default {
  server: { entry: './src/server.ts' },
  client: { entry: './src/client/index.html' },
  dev: { hmr: ${hmr} },
};
`;

  it("缺省两半都开（不写 dev 段也一样）", async () => {
    const workspace = await tempWorkspace({ "zephyr.config.ts": CONFIG });
    const resolved = await loadConfig({ cwd: workspace, env: {} });
    expect(resolved.hmr).toEqual({ client: true, server: true });
  });

  it("配置里关掉一半，另一半不受影响", async () => {
    const workspace = await tempWorkspace({ "zephyr.config.ts": withHmr("{ server: false }") });
    const resolved = await loadConfig({ cwd: workspace, env: {} });
    expect(resolved.hmr).toEqual({ client: true, server: false });
  });

  it("环境变量覆盖配置：关掉的能临时打开，打开的能临时关掉", async () => {
    const workspace = await tempWorkspace({
      "zephyr.config.ts": withHmr("{ client: false, server: true }"),
    });
    const resolved = await loadConfig({
      cwd: workspace,
      env: { ZEPHYR_HMR_CLIENT: "1", ZEPHYR_HMR_SERVER: "0" },
    });
    expect(resolved.hmr).toEqual({ client: true, server: false });
  });

  it("环境变量与配置一致时不必写配置文件", async () => {
    const workspace = await tempWorkspace({ "zephyr.config.ts": CONFIG });
    const resolved = await loadConfig({
      cwd: workspace,
      env: { ZEPHYR_HMR_SERVER: "off" },
    });
    expect(resolved.hmr).toEqual({ client: true, server: false });
  });

  it("环境变量取值非法：当场报错并指出是哪个变量（拼错不该静默）", async () => {
    const workspace = await tempWorkspace({ "zephyr.config.ts": CONFIG });
    await expect(
      loadConfig({ cwd: workspace, env: { ZEPHYR_HMR_CLIENT: "maybe" } }),
    ).rejects.toThrowError(/ZEPHYR_HMR_CLIENT/u);
  });
});
