import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROFILE_NAME, PROFILE_PATCH_NAME } from "./appconfig.ts";

export const SEED_DIR_NAME = "dsh-home";

export const SEED_HASH_NAME = ".seed-hash";

// Seed-relative directory holding the immutable runtime: the host's dsh installation and the Web frontend.
export const SEED_RUNTIME_DIR_NAME = "runtime";

const SEED_SKIP_DIRS = new Set([".nub-store", ".store", ".nub"]);

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readSeedHash(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 解压随包的依赖归档：实体文件、闭包完整（替代逐包 `link:` 那种写法）。 */
async function extractProfileModules(archive: string, profileDir: string): Promise<void> {
  await new Promise<void>((done, fail) => {
    const child = spawn("tar", ["-xzf", archive, "-C", profileDir], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0 ? done() : fail(new Error(`tar -xzf ${archive} exited with ${String(code)}`)),
    );
  });
}

export const PROFILE_MODULES_ARCHIVE_NAME = "profile-node-modules.tar";

/** 一次"种 profile"的结果：调用方据此记录、并在打包形态把 `no-seed` 当致命。 */
export type SeedOutcome = "seeded" | "up-to-date" | "no-seed";

/** 依赖面是否真的在：`node_modules` 存在且非空。 */
async function hasDependencies(profileDir: string): Promise<boolean> {
  const modules = join(profileDir, "node_modules");
  if (!(await isDirectory(modules))) return false;
  return (await readdir(modules)).length > 0;
}

/**
 * 把随包的种子种成一份可用的 profile：清单 + 各 bundle 自己的 patch 从种子拷（用户那份 patch 除外），
 * **依赖面**由随包归档解压而来。种完才算数——调用方要等它返回才起宿主。
 *
 * 判"已是最新"要同时满足：指纹一致 **且** 依赖面真的在（归档在场时）。指纹只说明"清单与闭包是哪一份"，
 * 不说明"它被解压出来了"：少了后半句，一次解压失败（或谁清过 `node_modules`）就永远补不回来，宿主会一直
 * 带着残缺 profile 起来。
 * @param seedDir - 随包的种子根（`Resources/seed`）。
 * @param home - 数据面根（`$DSH_HOME`）；profile 落在 `<home>/profiles/<name>`。
 * @returns 种了（`seeded`）、已是最新（`up-to-date`）、或随包根本没有这份种（`no-seed`）。
 * @throws 归档解压失败、或解压后没有依赖面时。
 */
export async function ensureSeedProfile(seedDir: string, home: string): Promise<SeedOutcome> {
  const seedProfile = join(seedDir, "profiles", PROFILE_NAME);
  if (!(await isDirectory(seedProfile))) return "no-seed";
  const profileDir = join(home, "profiles", PROFILE_NAME);
  const archive = join(seedDir, PROFILE_MODULES_ARCHIVE_NAME);
  const hasArchive = await pathExists(archive);
  const seedHash = await readSeedHash(join(seedProfile, SEED_HASH_NAME));
  if (seedHash !== "") {
    try {
      const stat = await lstat(profileDir);
      if (
        !stat.isSymbolicLink() &&
        (await readSeedHash(join(profileDir, SEED_HASH_NAME))) === seedHash &&
        (!hasArchive || (await hasDependencies(profileDir)))
      ) {
        return "up-to-date";
      }
    } catch {}
  }
  // profile 的 patch 文档是用户数据（settings 面板写在那里）：重种换的是装配面，
  // 这一份先读出来、种完再放回去，升级不会把用户的设置带走。
  const patchPath = join(profileDir, PROFILE_PATCH_NAME);
  const userPatch = await readFile(patchPath, "utf8").catch(() => undefined);

  try {
    const stat = await lstat(profileDir);
    if (stat.isSymbolicLink()) await unlink(profileDir);
    else if (stat.isDirectory()) await rm(profileDir, { recursive: true });
    else await unlink(profileDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await copySeed(seedProfile, profileDir);

  // **profile 的依赖面**：随包那份归档解压进来（实体文件、闭包完整）。历史做法是壳按载荷清单逐包
  // `link:`——`link` 不带传递依赖（上千个包会丢），路径还指向构建机（`.pnpm/<pkg>@file++++Users+…`）。
  if (hasArchive) {
    await rm(join(profileDir, "node_modules"), { recursive: true, force: true });
    await extractProfileModules(archive, profileDir);
    // **解压之后自检**：tar 退出码 0 不等于"闭包真的落地了"；种出来的东西不完整就该当场报，
    // 而不是让宿主带着残缺 profile 起一次（那只能表现为"组件不完整"）。
    if (!(await hasDependencies(profileDir))) {
      throw new Error(
        `dsh desktop: ${archive} did not yield a dependency closure at ${join(profileDir, "node_modules")}`,
      );
    }
  }
  if (userPatch !== undefined) {
    await mkdir(dirname(patchPath), { recursive: true });
    await writeFile(patchPath, userPatch);
  }
  return "seeded";
}

// Plant one profile subtree. The seed's runtime lives beside the profile and stays in the
// application's read-only resources, so only `profiles/<name>` is copied into the home.
async function copySeed(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const destination = join(target, ...relativePath.split("/"));
      if (entry.isSymbolicLink()) {
        if (await pathExists(destination)) continue;
        await mkdir(dirname(destination), { recursive: true });
        await symlink(
          await readlink(path),
          destination,
          process.platform === "win32" ? "junction" : "dir",
        );
        continue;
      }
      let stat: Stats;
      try {
        stat = await lstat(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (SEED_SKIP_DIRS.has(entry.name)) continue;
        await mkdir(destination, { recursive: true });
        await visit(path, relativePath);
        continue;
      }
      if (!stat.isFile() || (await pathExists(destination))) continue;
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(path, destination);
      await chmod(destination, stat.mode & 0o777);
    }
  };
  await visit(source, "");
}
