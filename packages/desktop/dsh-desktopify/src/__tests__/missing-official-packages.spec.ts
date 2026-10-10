import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { missingOfficialPackagesError } from "../cli/prepare-seed.ts";

interface Manifest {
  name?: string;
  scripts?: Record<string, string>;
}

const PACKAGE_ROOT = resolve(import.meta.dirname, "..", "..");
const SHELL_ROOT = resolve(PACKAGE_ROOT, "..", "dsh-desktop-shell");

async function manifest(root: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Manifest;
}

const desktopify = await manifest(PACKAGE_ROOT);
const shell = await manifest(SHELL_ROOT);

// 提示里的可执行入口写法：`pnpm --filter <包名> run <脚本名>`。
const REMEDIATION_COMMAND = /`pnpm --filter (\S+) run (\S+)`/u;

function message(): string {
  return missingOfficialPackagesError(new Map([["@deepseek-ai/dsh-missing", ["@morlay/plugin"]]]))
    .message;
}

describe("desktop seed missing official packages error", () => {
  it("points at the shell package's generator, which really is on disk", async () => {
    expect(shell.name).toBe("@morlay/dsh-desktop-shell");
    const matched = REMEDIATION_COMMAND.exec(message());
    expect(matched).not.toBeNull();
    if (matched === null) return;
    expect(matched[1]).toBe(shell.name);
    const command = shell.scripts?.[matched[2] ?? ""];
    expect(command).toBeDefined();
    // TS 脚本靠随仓库的 oxc loader 直跑（`node --import=…ts-loader.mjs <脚本>`）：仓库里没有 tsx 依赖，
    // `node_modules/.bin/tsx` 只是别家依赖顺带提升上来的。
    const [runner, loaderArg, target] = (command ?? "").trim().split(/\s+/u);
    expect(runner).toBe("node");
    expect(loaderArg).toMatch(/^--import=.*ts-loader\.mjs$/u);
    expect((await stat(join(SHELL_ROOT, target ?? ""))).isFile()).toBe(true);
  });

  it("keeps the missing package detail", () => {
    expect(message()).toContain("desktop seed: deployed closure is missing official packages");
    expect(message()).toContain("@deepseek-ai/dsh-missing (required by @morlay/plugin)");
  });

  // 注入面归壳包：本包不留同名入口，也不转发（本包没有那个生成器，转发只是第二个名字）。
  it("keeps the generator entry out of desktopify", () => {
    expect(desktopify.scripts?.["gen:official-packages"]).toBeUndefined();
  });
});
