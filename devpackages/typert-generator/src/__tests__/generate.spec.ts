import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateTypert } from "../index.ts";

// 端到端：造一个最小上游包 + 一棵声明树，断言三件套产物都出来了。

async function fixture(
  options: { client?: boolean } = {},
): Promise<{ upstreamRoot: string; dtsRoot: string }> {
  // 真实布局：`<repo>/vendor/<name>` 与 `<repo>/target/dts`——owner 推导靠这两者的相对位置。
  const repo = await mkdtemp(join(tmpdir(), "typert-ws-"));
  const upstreamRoot = join(repo, "vendor", "demo-harness");
  const dtsRoot = join(repo, "target", "dts");
  const pkg = join(upstreamRoot, "packages", "demo", "demo");
  await mkdir(join(pkg, "src"), { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    `${JSON.stringify({
      name: "@x/demo",
      exports: {
        ".": "./src/index.ts",
        ...(options.client === true ? { "./client": "./src/client/index.ts" } : {}),
      },
      ...(options.client === true ? { dsh: { client: { entry: "./src/client/index.ts" } } } : {}),
    })}\n`,
  );
  await writeFile(
    join(pkg, "src", "index.ts"),
    [
      "/** Demo service. */",
      "export class Demo extends TypertRemoteService {",
      "  constructor(ctx: Context) { super(ctx, 'demo', { namespace: 'demo' }) }",
      "  /** Read a payload. */",
      "  @Remote",
      "  async read(payload: Payload): Promise<Payload> { return payload }",
      "}",
      "",
    ].join("\n"),
  );
  const dtsPkg = join(dtsRoot, "vendor", "demo-harness", "packages", "demo", "demo", "src");
  await mkdir(dtsPkg, { recursive: true });
  await writeFile(join(dtsPkg, "types.d.ts"), "export interface Payload {\n    id: string;\n}\n");
  return { upstreamRoot, dtsRoot };
}

describe("typert 产物生成", () => {
  it("产出 host / client / remote-client 三件套，并带上 invocation 与反射", async () => {
    const { upstreamRoot, dtsRoot } = await fixture({ client: true });
    const artifacts = await generateTypert({ upstreamRoot, dtsRoot });
    expect(artifacts).toHaveLength(1);
    const files = artifacts[0]?.files ?? [];
    const host = files.find((file) => file.path.endsWith("typert.host.ts"))?.text ?? "";
    expect(host).toContain("export const TYPERT: unknown = {");
    expect(host).toContain("id: '@x/demo#demo/read'");
    expect(host).toContain("'id': z.string(),");
    expect(host).toContain('"summary": "Demo service."');
    expect(files.some((file) => file.path.endsWith("typert.client.ts"))).toBe(true);
    const remote = files.find((file) => file.path.endsWith("typert.remote-client.ts"))?.text ?? "";
    expect(remote).toContain("export const TYPERT_REMOTE: TypertRemoteContribution = {");
    expect(remote).toContain("declare module '@deepseek-ai/dsh-typert-protocol' {");
    expect(remote).toContain("read: (payload: Payload) => Promise<RemoteResult<Payload>>");
  });

  it("三件套的 wire 细节：可选参数、AbortSignal、stream、typeSymbol、declare module", async () => {
    const repo = await mkdtemp(join(tmpdir(), "typert-ws-"));
    const upstreamRoot = join(repo, "vendor", "demo-harness");
    const dtsRoot = join(repo, "target", "dts");
    const pkg = join(upstreamRoot, "packages", "demo", "demo");
    await mkdir(join(pkg, "src"), { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      `${JSON.stringify({ name: "@x/demo", exports: { ".": "./src/index.ts" } })}\n`,
    );
    await writeFile(
      join(pkg, "src", "index.ts"),
      [
        "/** Demo service. */",
        "export class Demo extends TypertRemoteService {",
        "  constructor(ctx: Context) { super(ctx, 'demo', { namespace: 'demo' }) }",
        "  /** Direct call. */",
        "  @Remote",
        "  async read(payload: Payload, options?: Options, signal?: AbortSignal): Promise<Payload> { throw new Error() }",
        "  /** Stream call. */",
        "  @Remote({ mode: 'stream' })",
        "  async *watch(signal: AbortSignal): AsyncIterable<boolean> { yield true }",
        "}",
        "",
      ].join("\n"),
    );
    const dtsPkg = join(dtsRoot, "vendor", "demo-harness", "packages", "demo", "demo", "src");
    await mkdir(dtsPkg, { recursive: true });
    await writeFile(
      join(dtsPkg, "types.d.ts"),
      "export interface Payload {\n    id: string;\n}\nexport interface Options {\n    deep?: boolean;\n}\n",
    );
    const artifacts = await generateTypert({ upstreamRoot, dtsRoot });
    const files = artifacts[0]?.files ?? [];
    const host = files.find((file) => file.path.endsWith("typert.host.ts"))?.text ?? "";
    // 可选参数在 wire 上是 `undefined | T`
    expect(host).toContain("z.union([z.undefined(), z.object({");
    // 具名类型用类型的符号（stream 方法的 `AsyncIterable<T>` 也要解包）；内联类型用方法级符号
    expect(host).toContain("typeSymbol: '@x/demo#Payload'");
    expect(host).toContain("typeSymbol: '@x/demo#demo/watch:result'");
    // 该包的声明树里有 `types.ts`，出口是 `.`——类型符号要带它自己的出口
    expect(host).toContain("typeSymbol: '@x/demo#Payload'");
    // AbortSignal 不进参数、记成 cancellation
    expect(host).toContain("cancellation: { parameter: 'signal' }");
    const remote = files.find((file) => file.path.endsWith("typert.remote-client.ts"))?.text ?? "";
    // stream 方法的 mode 与声明面签名
    expect(remote).toContain("mode: 'stream'");
    expect(remote).toContain("watch: (signal?: AbortSignal) => RemoteStreamHandle<boolean, never>");
    expect(remote).toContain("read: (payload: Payload, options?: Options, signal?: AbortSignal) => Promise<RemoteResult<Payload>>");
    // declare module 三段齐（少了 NamespaceMap，client 半的类型会整片解析不到）
    expect(remote).toContain("interface TypertRemoteNamespace$");
    expect(remote).toContain("interface TypertRemoteNamespaceMap {");
    expect(remote).toContain("interface TypertRemoteMap {");
    expect(remote).toContain("'demo': TypertRemoteNamespace$");
  });

  it("`@Remote('wire')` 的第一个参数是 wire 名（方法名只是实现名）", async () => {
    const { upstreamRoot, dtsRoot } = await fixture();
    await writeFile(
      join(upstreamRoot, "packages", "demo", "demo", "src", "index.ts"),
      [
        "export class Demo extends TypertRemoteService {",
        "  constructor(ctx: Context) { super(ctx, 'demo') }",
        "  @Remote('list')",
        "  async remoteExportList(): Promise<string> { throw new Error() }",
        "}",
        "",
      ].join("\n"),
    );
    const artifacts = await generateTypert({ upstreamRoot, dtsRoot });
    const host = artifacts[0]?.files.find((f) => f.path.endsWith("typert.host.ts"))?.text ?? "";
    expect(host).toContain("method: 'list'");
    expect(host).toContain("id: '@x/demo#demo/list'");
    expect(host).not.toContain("remoteExportList'");
  });

  it("没有 client 半的包会删掉陈旧的 typert.client.ts", async () => {
    const { upstreamRoot, dtsRoot } = await fixture();
    const lib = join(upstreamRoot, "packages", "demo", "demo", "lib");
    await mkdir(lib, { recursive: true });
    await writeFile(join(lib, "typert.client.ts"), "陈旧残留\n");
    await generateTypert({ upstreamRoot, dtsRoot, write: true });
    // 产物按包覆盖写：留着上一次的会变成引用已改名常量的陈旧文件（运行时直接炸）
    await expect(stat(join(lib, "typert.client.ts"))).rejects.toThrow();
  });

  it("没有 @Remote 方法的包不产物", async () => {
    const { upstreamRoot, dtsRoot } = await fixture();
    const pkg = join(upstreamRoot, "packages", "demo", "demo", "src", "index.ts");
    await writeFile(pkg, "export class Nothing {}\n");
    expect(await generateTypert({ upstreamRoot, dtsRoot })).toEqual([]);
  });
});
