import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installPlan } from "../cli/bundle.ts";

const roots: string[] = [];

async function tempDir(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "dsh-desktopify-install-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const NAME = "dsh-custom-next";
const DISPLAY_NAME = "DSH Custom Next";

describe("installPlan", () => {
  it("installs the macOS bundle under the display name", async () => {
    const artifacts = await tempDir();
    const bundle = join(artifacts, "mac-arm64", `${DISPLAY_NAME}.app`);
    await mkdir(bundle, { recursive: true });

    expect(
      await installPlan({
        platform: "darwin",
        artifacts,
        home: "/home/user",
        name: NAME,
        displayName: DISPLAY_NAME,
      }),
    ).toEqual({
      source: bundle,
      target: join("/Applications", `${DISPLAY_NAME}.app`),
      copySymlinksVerbatim: true,
    });
  });

  it("refuses a macOS build without exactly one application bundle", async () => {
    const artifacts = await tempDir();
    await mkdir(join(artifacts, "mac-arm64"), { recursive: true });

    await expect(async () =>
      installPlan({
        platform: "darwin",
        artifacts,
        home: "/home/user",
        name: NAME,
        displayName: DISPLAY_NAME,
      }),
    ).rejects.toThrow(/missing built application/u);
  });

  // 启动器名字是人看的（显示名），可执行文件与目录名是壳的身份标识（包名）——后者与 electron-builder 的
  // `linux.executableName` 同一个，`Exec` 才指向真实存在的文件。
  it("names the Linux executable after the package and the menu entry after the display name", async () => {
    const artifacts = await tempDir();
    const home = "/home/user";

    const plan = await installPlan({
      platform: "linux",
      artifacts,
      home,
      name: NAME,
      displayName: DISPLAY_NAME,
    });

    expect(plan.source).toBe(join(artifacts, "linux-unpacked"));
    expect(plan.target).toBe(join(home, ".local", "lib", NAME));
    expect(plan.copySymlinksVerbatim).toBe(false);
    expect(plan.desktopEntry?.path).toBe(
      join(home, ".local", "share", "applications", `${NAME}.desktop`),
    );
    expect(plan.desktopEntry?.contents).toBe(
      [
        "[Desktop Entry]",
        "Type=Application",
        `Name=${DISPLAY_NAME}`,
        `Exec=${join(plan.target, NAME)}`,
        "Terminal=false",
        "",
      ].join("\n"),
    );
  });

  it("installs the Windows build under the package name", async () => {
    const artifacts = await tempDir();

    const plan = await installPlan({
      platform: "win32",
      artifacts,
      home: "/home/user",
      name: NAME,
      displayName: DISPLAY_NAME,
      localAppData: "/appdata/Local",
    });

    expect(plan.source).toBe(join(artifacts, "win-unpacked"));
    expect(plan.target).toBe(join("/appdata/Local", "Programs", NAME));
    expect(plan.desktopEntry).toBeUndefined();
  });

  it("refuses an unsupported platform", async () => {
    await expect(async () =>
      installPlan({
        platform: "freebsd",
        artifacts: "/build/artifacts",
        home: "/home/user",
        name: NAME,
        displayName: DISPLAY_NAME,
      }),
    ).rejects.toThrow(/unsupported platform/u);
  });
});
