import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// ts-loader 是 `--import` 的目标：它在自己的进程里注册同步 hooks，且 hooks 没有反注册入口。
// 因此每个用例都另起一个 node 子进程，用真实入口加载 fixture（与 dev / 构建期的装载方式一致）。
const TS_LOADER = fileURLToPath(new URL("../ts-loader.mjs", import.meta.url));

// oxc 的 legacy 降级把类装饰器写成 `X = babelHelpers.decorate([…], X)`，装饰器不返回值时也必须把
// 类交回去；这里的 `mark` 与上游 `@Inject` 的 legacy 分路一样在类分支上不返回值。
const FIXTURE = `
function mark(label) {
  return function (target, key, descriptor) {
    if (key === undefined) {
      target.marks = [...(target.marks ?? []), label];
      return;
    }
    if (descriptor !== undefined) globalThis.seenDescriptor = descriptor;
  };
}

@mark('a')
@mark('b')
class Decorated {
  @mark('field') static value = 1;
  @mark('method') method() {
    return 'ok';
  }
}

export default Decorated;
`;
const PROBE = `
const decorated = namespace.default;
process.stdout.write(JSON.stringify({
  typeofClass: typeof decorated,
  marks: decorated?.marks ?? null,
  staticValue: decorated?.value ?? null,
  methodResult: decorated ? new decorated().method() : null,
  descriptorKind: typeof globalThis.seenDescriptor,
}));
`;

async function runFixture(): Promise<{ stdout: string; stderr: string }> {
  const directory = await mkdtemp(join(tmpdir(), "dsh-ts-loader-"));
  try {
    const modulePath = join(directory, "decorated.ts");
    const probePath = join(directory, "probe.mjs");
    await writeFile(modulePath, FIXTURE);
    // 按 default 导出取类：`hmr` 行的失败症状正是这个 `default` 变成 undefined。
    await writeFile(
      probePath,
      `const namespace = await import(${JSON.stringify(pathToFileURL(modulePath).href)});${PROBE}`,
    );
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", pathToFileURL(TS_LOADER).href, probePath],
      { encoding: "utf8" },
    );
    return { stdout, stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("ts-loader 的 legacy 装饰器 helper", () => {
  it("类装饰器不返回值时，被装饰的类仍然是类（default 导出不会被抹成 undefined）", async () => {
    const result = await runFixture();

    expect(result.stderr).toBe("");
    const actual = JSON.parse(result.stdout) as {
      typeofClass: string;
      marks: string[] | null;
      staticValue: number | null;
      methodResult: string | null;
      descriptorKind: string;
    };
    expect(actual.typeofClass).toBe("function");
    // 逆序应用，与 tsc 的 `__decorate` 一致。
    expect(actual.marks).toEqual(["b", "a"]);
  });

  it("字段与方法装饰器仍收到现成的 descriptor，且不破坏成员定义", async () => {
    const actual = JSON.parse((await runFixture()).stdout) as {
      staticValue: number | null;
      methodResult: string | null;
      descriptorKind: string;
    };

    expect(actual.staticValue).toBe(1);
    expect(actual.methodResult).toBe("ok");
    expect(actual.descriptorKind).toBe("object");
  });
});
