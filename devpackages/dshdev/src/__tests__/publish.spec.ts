import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { distTagOf, runPublish } from "../cli/publish.ts";

// 发布这一步要跑真 pnpm：把子进程换成可观测的替身，判「怎么起它」而不是起没起。
const spawnMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock, execFile: execFileMock }));

interface ViewStep {
  stdout?: string;
  stderr?: string;
  code?: number;
}

/** `pnpm view` 的替身：按调用顺序回放结果（缺省是「registry 上还没有」）。 */
function fakeView(steps: ViewStep[]): void {
  execFileMock.mockImplementation((...call: unknown[]) => {
    const callback = call[3] as (
      error: unknown,
      output?: { stdout: string; stderr: string },
    ) => void;
    const step = steps.shift() ?? { code: 1 };
    const code = step.code ?? 1;
    if (code === 0) {
      callback(null, { stdout: step.stdout ?? "", stderr: step.stderr ?? "" });
      return;
    }
    callback(
      Object.assign(new Error("command failed"), {
        code,
        stdout: step.stdout ?? "",
        stderr: step.stderr ?? "ERR_PNPM_PACKAGE_NOT_FOUND",
      }),
    );
  });
}

/** `pnpm publish` 的替身：只给退出码（输出直接进终端，没有捕获文本）。 */
function fakePublish(exitCode: number): void {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit("close", exitCode));
    return child;
  });
}

const directories: string[] = [];

async function cwdOf(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dshdev-publish-"));
  directories.push(directory);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "@morlay/foo", version: "1.0.0" }),
  );
  return directory;
}

beforeEach(() => {
  spawnMock.mockReset();
  execFileMock.mockReset();
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("distTagOf", () => {
  it("maps stable versions to latest and prereleases to alpha / next", () => {
    expect(distTagOf("0.2.11")).toBe("latest");
    expect(distTagOf("0.2.11-alpha.2")).toBe("alpha");
    expect(distTagOf("0.2.11-rc.1")).toBe("next");
    expect(distTagOf("0.2.11-beta.3+build.7")).toBe("next");
  });
});

describe("runPublish", () => {
  it("pnpm publish 继承当前终端：stdin 是 TTY，OTP 提示与进度都看得见", async () => {
    fakeView([{ code: 1 }, { code: 0, stdout: "1.0.0\n" }]);
    fakePublish(0);

    await expect(
      runPublish({
        cwd: await cwdOf(),
        registry: "https://registry.npmjs.org/",
        branch: "main",
      }),
    ).resolves.toBe(0);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0]!;
    expect(command).toBe("pnpm");
    expect(args).toEqual([
      "publish",
      "--access=public",
      "--tag=latest",
      "--publish-branch=main",
      "--registry",
      "https://registry.npmjs.org/",
    ]);
    expect(options).toEqual({ stdio: "inherit" });
  });

  it("发布失败但 registry 上已有该版本时算成功（以查询为准，不靠 stderr 文案）", async () => {
    fakeView([{ code: 1 }, { code: 0, stdout: "1.0.0\n" }]);
    fakePublish(1);

    await expect(
      runPublish({ cwd: await cwdOf(), registry: "https://registry.npmjs.org/", branch: "main" }),
    ).resolves.toBe(0);
  });

  it("registry 上也没有该版本时把退出码交回去", async () => {
    fakeView([{ code: 1 }, { code: 1 }]);
    fakePublish(1);

    await expect(
      runPublish({ cwd: await cwdOf(), registry: "https://registry.npmjs.org/", branch: "main" }),
    ).resolves.toBe(1);
  });

  it("已发布过的版本直接跳过，不起 publish", async () => {
    fakeView([{ code: 0, stdout: "1.0.0\n" }]);

    await expect(
      runPublish({ cwd: await cwdOf(), registry: "https://registry.npmjs.org/" }),
    ).resolves.toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("不改 @morlay/* 之外的包", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dshdev-publish-"));
    directories.push(directory);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "@deepseek-ai/dsh-llm", version: "1.0.0" }),
    );

    await expect(runPublish({ cwd: directory })).resolves.toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
