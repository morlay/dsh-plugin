import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const CLI = fileURLToPath(new URL("../cli/index.ts", import.meta.url));
const MANIFEST = JSON.parse(
  await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { bin?: Record<string, string>; version?: string };

const BIN_NAME = Object.keys(MANIFEST.bin ?? {})[0] ?? "";
const BIN_COMMANDS = [
  "web",
  "desktop",
  "check-deps",
  "check-locale",
  "check-docs",
  "manifest",
  "publish",
  "login",
];

const roots: string[] = [];

async function nonWorkspaceDir(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "dshdev-cli-"));
  roots.push(root);
  return root;
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// 子进程的环境：丢掉继承来的 `NODE_OPTIONS`（宿主 shell 挂的 oxc loader 按子进程 cwd 解析，
// 会把「不在工作区里报什么错」的用例顶成 ERR_MODULE_NOT_FOUND）。
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["NODE_OPTIONS"];
  return env;
}

async function cli(args: readonly string[], cwd?: string): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      env: childEnv(),
      ...(cwd === undefined ? {} : { cwd }),
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      status: typeof failure.code === "number" ? failure.code : null,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function listedCommands(help: string): string[] {
  const section = help.slice(help.indexOf("Commands:"));
  return section
    .split("\n")
    .slice(1)
    .map((line) => /^ {2}(\S+)/u.exec(line)?.[1])
    .filter((name): name is string => name !== undefined && name !== "help");
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("published command surface", () => {
  it("names the program after the published bin entry", async () => {
    const { status, stdout } = await cli(["--help"]);

    expect(status).toBe(0);
    expect(BIN_NAME).not.toBe("");
    expect(/^Usage: (\S+)/u.exec(stdout)?.[1]).toBe(BIN_NAME);
  });

  it("exposes exactly the dev / lint / release subcommands", async () => {
    const { stdout } = await cli(["--help"]);

    expect(listedCommands(stdout)).toEqual(BIN_COMMANDS);
    expect(stdout).not.toContain("prepare");
  });

  it("reports the package version", async () => {
    const { status, stdout } = await cli(["--version"]);

    expect(status).toBe(0);
    expect(stdout.trim()).toBe(MANIFEST.version);
  });

  it("给 web 与 desktop 都留了可选 workspace 参数（desktop 不带浏览器开关）", async () => {
    for (const command of ["web", "desktop"]) {
      const { status, stdout } = await cli([command, "--help"]);
      expect(status).toBe(0);
      expect(/\[workspace\]/u.test(stdout)).toBe(true);
      expect(/--web\b/u.test(stdout)).toBe(false);
    }
  });

  it("两个形态都有 --data-dir，且说明里点出 dataDir 的三种取值", async () => {
    for (const command of ["web", "desktop"]) {
      const { status, stdout } = await cli([command, "--help"]);
      expect(status).toBe(0);
      expect(/--data-dir\b/u.test(stdout)).toBe(true);
      expect(/xdg/u.test(stdout)).toBe(true);
      // 描述会被 help 折行，正则别假定它在一行里。
      expect(/absolute\s+path/u.test(stdout)).toBe(true);
    }
  });

  it("bundle 挂在 desktop 下，带 dir / install 与可选 workspace", async () => {
    const { status, stdout } = await cli(["desktop", "bundle", "--help"]);

    expect(status).toBe(0);
    expect(/--dir\b/u.test(stdout)).toBe(true);
    expect(/--install\b/u.test(stdout)).toBe(true);
    expect(/\[workspace\]/u.test(stdout)).toBe(true);
  });

  it("refuses an unknown subcommand", async () => {
    const { status, stderr } = await cli(["prepare:runtime"]);

    expect(status).not.toBe(0);
    expect(stderr).toContain("prepare:runtime");
  });
});

// 没有源码入口的数据包（`dsh.bundle` 的纯数据包）的清单写回：出口与 dsh 版本要求都由构建推导，
// 但这类包没有可打包的入口、进不了 tsdown 的 `build:done`，所以给它一条命令走同一份推导。
describe("manifest 写回", () => {
  it("按文件存在性写固定面，并按 DEEPSEEK_HARNESS_VERSION 写 engines.dsh", async () => {
    const root = await nonWorkspaceDir();
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "@morlay/data-fixture",
          private: true,
          dsh: { bundle: { patch: "./cordis.patch.yml" } },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(root, "cordis.patch.yml"), "# patch\n");
    await mkdir(join(root, "locale"), { recursive: true });
    await writeFile(join(root, "locale", "en.json"), "{}\n");

    process.env["DEEPSEEK_HARNESS_VERSION"] = "0.2.1-alpha.5";
    try {
      const { status, stderr } = await cli(["manifest"], root);
      expect(stderr).toBe("");
      expect(status).toBe(0);
    } finally {
      delete process.env["DEEPSEEK_HARNESS_VERSION"];
    }

    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
      publishConfig?: { exports?: Record<string, unknown> };
      engines?: Record<string, unknown>;
    };
    const faces = {
      "./package.json": "./package.json",
      "./cordis.patch.yml": "./cordis.patch.yml",
      "./locale/*.json": "./locale/*.json",
    };
    expect(manifest.exports).toEqual(faces);
    expect(manifest.publishConfig?.exports).toEqual(faces);
    expect(manifest.engines).toEqual({ dsh: ">= 0.2.1-alpha.5 < 0.2.2" });
  });
});

describe("workspace argument plumbing", () => {
  it("resolves the positional workspace instead of the working directory", async () => {
    const workspace = await nonWorkspaceDir();
    const { status, stderr } = await cli(["desktop", workspace], await nonWorkspaceDir());

    expect(status).toBe(1);
    expect(stderr).toContain("no pnpm-workspace.yaml found above");
    expect(stderr).toContain(basename(workspace));
  });

  it("defaults the workspace to the working directory", async () => {
    const workspace = await nonWorkspaceDir();
    const { status, stderr } = await cli(["desktop", "bundle"], workspace);

    expect(status).toBe(1);
    expect(stderr).toContain(basename(workspace));
    expect(stderr).toContain("package.json");
  });
});
