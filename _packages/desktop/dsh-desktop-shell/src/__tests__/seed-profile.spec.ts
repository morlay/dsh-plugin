import { spawn } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureSeedProfile,
  PROFILE_MODULES_ARCHIVE_NAME,
  SEED_DIR_NAME,
  SEED_HASH_NAME,
} from "../seed.ts";

const roots: string[] = [];

async function exists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

async function write(path: string, content = ""): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

interface Fixture {
  readonly seed: string;
  readonly home: string;
  readonly seedProfile: string;
  readonly homeProfile: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), "dshdev-seed-"));
  roots.push(root);
  const seed = join(root, SEED_DIR_NAME);
  const home = join(root, "home");
  const seedProfile = join(seed, "profiles", "desktop");
  await write(join(seedProfile, SEED_HASH_NAME), "abc123");
  await write(join(seedProfile, "cordis.patch.yml"), "- insert: []\n");
  return { seed, home, seedProfile, homeProfile: join(home, "profiles", "desktop") };
}

// 造一份**真的**随包归档（与打包时同名同布局）：`node_modules/<pkg>/…` 打成一个 tar。
async function makeArchive(seed: string, entries: Readonly<Record<string, string>>): Promise<void> {
  const stage = join(seed, ".stage");
  for (const [relative, content] of Object.entries(entries)) {
    await write(join(stage, ...relative.split("/")), content);
  }
  await new Promise<void>((done, fail) => {
    const child = spawn(
      "tar",
      ["czf", join(seed, PROFILE_MODULES_ARCHIVE_NAME), "-C", stage, "node_modules"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0 ? done() : fail(new Error(`tar exited with ${String(code)}`)),
    );
  });
}

const ARCHIVE_ONE = { "node_modules/fixture-pkg/index.js": "export default 1;\n" } as const;

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("seed profile planting", () => {
  it("plants the profile into an empty app home", async () => {
    const { seed, home, homeProfile } = await fixture();

    expect(await ensureSeedProfile(seed, home)).toBe("seeded");
    expect(await readFile(join(homeProfile, "cordis.patch.yml"), "utf8")).toBe("- insert: []\n");
    expect(await readFile(join(homeProfile, SEED_HASH_NAME), "utf8")).toBe("abc123");
  });

  it("leaves a matching profile alone on the next launch", async () => {
    const { seed, home, homeProfile } = await fixture();
    await ensureSeedProfile(seed, home);
    await write(join(homeProfile, "local-state.json"), "{}\n");

    expect(await ensureSeedProfile(seed, home)).toBe("up-to-date");
    expect(await readFile(join(homeProfile, "local-state.json"), "utf8")).toBe("{}\n");
  });

  it("replaces the profile when the seed fingerprint changes", async () => {
    const { seed, home, homeProfile, seedProfile } = await fixture();
    await ensureSeedProfile(seed, home);
    await write(join(homeProfile, "stale.json"), "{}\n");

    await write(join(seedProfile, SEED_HASH_NAME), "def456");
    await write(join(seedProfile, "extra.json"), "{}\n");

    expect(await ensureSeedProfile(seed, home)).toBe("seeded");
    expect(await exists(join(homeProfile, "stale.json"))).toBe(false);
    expect(await exists(join(homeProfile, "extra.json"))).toBe(true);
    expect(await readFile(join(homeProfile, SEED_HASH_NAME), "utf8")).toBe("def456");
  });

  it("re-plants everything but the user's own patch document", async () => {
    const { seed, home, homeProfile, seedProfile } = await fixture();
    await ensureSeedProfile(seed, home);
    const settings = "- id: locale\n  config:\n    preference: zh\n";
    await write(join(homeProfile, "cordis.patch.yml"), settings);
    await write(join(homeProfile, "stale.json"), "{}\n");

    await write(join(seedProfile, SEED_HASH_NAME), "def456");
    await write(join(seedProfile, "cordis.patch.yml"), "- id: locale\n");

    expect(await ensureSeedProfile(seed, home)).toBe("seeded");

    // 替换逻辑照旧（种子的文件覆盖、旧文件清掉），只有这一份豁免：settings 写在这里。
    expect(await readFile(join(homeProfile, "cordis.patch.yml"), "utf8")).toBe(settings);
    expect(await exists(join(homeProfile, "stale.json"))).toBe(false);
    expect(await readFile(join(homeProfile, SEED_HASH_NAME), "utf8")).toBe("def456");
  });

  it("re-plants when the seed carries no fingerprint", async () => {
    const { seed, home, seedProfile } = await fixture();
    await rm(join(seedProfile, SEED_HASH_NAME));

    expect(await ensureSeedProfile(seed, home)).toBe("seeded");
    expect(await ensureSeedProfile(seed, home)).toBe("seeded");
  });

  it("does nothing when the seed has no desktop profile", async () => {
    const { seed, home } = await fixture();
    await rm(join(seed, "profiles"), { recursive: true });

    expect(await ensureSeedProfile(seed, home)).toBe("no-seed");
    expect(await exists(home)).toBe(false);
  });

  it("keeps symlinks as links and skips the store directories", async () => {
    const { seed, home, homeProfile, seedProfile } = await fixture();
    await write(join(seed, "node_modules", "pkg", "index.js"), "module.exports = {};\n");
    await symlink(join("..", "..", "node_modules", "pkg"), join(seedProfile, "pkg-link"), "dir");
    await write(join(seedProfile, ".store", "cached.txt"), "cached\n");

    expect(await ensureSeedProfile(seed, home)).toBe("seeded");
    expect((await lstat(join(homeProfile, "pkg-link"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(homeProfile, "pkg-link"))).toBe(
      join("..", "..", "node_modules", "pkg"),
    );
    expect(await exists(join(homeProfile, ".store"))).toBe(false);
  });

  it("plants the dependency closure from the shipped archive", async () => {
    const { seed, home, homeProfile } = await fixture();
    await makeArchive(seed, ARCHIVE_ONE);

    expect(await ensureSeedProfile(seed, home)).toBe("seeded");
    expect(await exists(join(homeProfile, "node_modules", "fixture-pkg", "index.js"))).toBe(true);
    // 依赖面在了，指纹也一致：下一次不该再种。
    expect(await ensureSeedProfile(seed, home)).toBe("up-to-date");
  });

  it("re-plants when the fingerprint matches but the closure is gone", async () => {
    const { seed, home, homeProfile } = await fixture();
    await makeArchive(seed, ARCHIVE_ONE);
    await ensureSeedProfile(seed, home);

    // 上一次解压失败、或用户清过：指纹（种子自己的）仍然一致，但依赖面没了——**必须补**，
    // 否则宿主会带着残缺的 profile 起来（表现是"组件不完整"，而且永远等不到它自愈）。
    await rm(join(homeProfile, "node_modules"), { recursive: true, force: true });

    expect(await ensureSeedProfile(seed, home)).toBe("seeded");
    expect(await exists(join(homeProfile, "node_modules", "fixture-pkg", "index.js"))).toBe(true);
  });

  it("fails loud when the archive does not yield a closure", async () => {
    const { seed, home } = await fixture();
    await write(join(seed, PROFILE_MODULES_ARCHIVE_NAME), "not a tar at all\n");

    await expect(ensureSeedProfile(seed, home)).rejects.toThrow(/tar -xzf/u);
  });
});
