import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { distTagOf, publishOutcome, runPublish } from "../cli/publish.ts";

// 发布这一步要跑真 pnpm：把子进程换成可观测的替身，判「怎么起它」与「结果怎么判」。
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

interface PipeStream extends EventEmitter {
  setEncoding(encoding: string): PipeStream;
}

function pipeStream(): PipeStream {
  const stream = new EventEmitter() as PipeStream;
  stream.setEncoding = () => stream;
  return stream;
}

/** `pnpm publish` 的替身：stdin/stdout 继承、stderr 走管道，按需回放文本与退出码。 */
function fakePublish(exitCode: number, output: { stderr?: string } = {}): void {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stderr: PipeStream };
    child.stderr = pipeStream();
    process.nextTick(() => {
      if (output.stderr !== undefined) child.stderr.emit("data", output.stderr);
      child.emit("close", exitCode);
    });
    return child;
  });
}

const REPUBLISH_403 =
  "Error: ERR_PNPM_FAILED_TO_PUBLISH\n\n  × Failed to publish package @morlay/dsh-oxc-node@0.2.12 (status 403 Forbidden): " +
  '{"success":false,"error":"You cannot publish over the previously published versions: 0.2.12."}';

const directories: string[] = [];

async function directoryOf(manifest: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dshdev-publish-"));
  directories.push(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  return directory;
}

async function cwdOf(): Promise<string> {
  return await directoryOf({ name: "@morlay/foo", version: "1.0.0" });
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

describe("publishOutcome", () => {
  it("treats a zero exit as published", () => {
    expect(publishOutcome({ status: 0, stderr: "" })).toBe("published");
  });

  it("treats 409 as already published (another job won the race)", () => {
    expect(publishOutcome({ status: 409, stderr: "" })).toBe("already-published");
  });

  it("treats npm's 403 'cannot publish over the previously published versions' as already published", () => {
    expect(publishOutcome({ status: 1, stderr: REPUBLISH_403 })).toBe("already-published");
  });

  it("treats EPUBLISHCONFLICT as already published", () => {
    expect(
      publishOutcome({ status: 1, stderr: "npm ERR! code EPUBLISHCONFLICT: cannot publish over" }),
    ).toBe("already-published");
  });

  it("keeps real failures as failures", () => {
    expect(
      publishOutcome({
        status: 1,
        stderr: "status 403 Forbidden: You do not have permission to publish this package.",
      }),
    ).toBe("failed");
    expect(publishOutcome({ status: null, stderr: "" })).toBe("failed");
  });
});

describe("runPublish", () => {
  it("stdin 与 stdout 都继承当前终端：pnpm 的 OTP 要求两者都是 TTY", async () => {
    fakeView([{ code: 1 }]);
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
    expect(options).toEqual({ stdio: ["inherit", "inherit", "pipe"] });
  });

  it("403「不能覆盖已发布版本」当场算已发布，不再问 registry（view 可能命中旧缓存）", async () => {
    fakeView([{ code: 1 }]);
    fakePublish(1, { stderr: REPUBLISH_403 });

    await expect(
      runPublish({ cwd: await cwdOf(), registry: "https://registry.npmjs.org/", branch: "main" }),
    ).resolves.toBe(0);
    // 只有发布前那次 view（确认还没发过），没有发后复查。
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("文案变了也认事实：发布失败后 registry 上查得到就算成功", async () => {
    fakeView([{ code: 1 }, { code: 0, stdout: "1.0.0\n" }]);
    fakePublish(1, { stderr: "something changed" });

    await expect(
      runPublish({ cwd: await cwdOf(), registry: "https://registry.npmjs.org/", branch: "main" }),
    ).resolves.toBe(0);
  });

  it("registry 上也没有该版本时把退出码交回去", async () => {
    fakeView([{ code: 1 }, { code: 1 }]);
    fakePublish(1, { stderr: "status 403 Forbidden: no permission" });

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
    const directory = await directoryOf({ name: "@deepseek-ai/dsh-llm", version: "1.0.0" });

    await expect(runPublish({ cwd: directory })).resolves.toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("跳过标了 private 的包（不查 registry、也不发布）", async () => {
    const directory = await directoryOf({
      name: "@morlay/mydsh-profile",
      version: "0.0.15",
      private: true,
    });

    await expect(runPublish({ cwd: directory })).resolves.toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
