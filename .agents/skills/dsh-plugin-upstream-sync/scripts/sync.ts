import { join, resolve } from "node:path";
import { execFileCapture, pathExists, requireWorkspaceEnv, runInherited } from "./common.ts";

// 同步上游到指定提交（git 增量）：目录缺失 → 首次 clone，存在 → fetch + reset --hard（目标相同也 reset，
// 保证 repatch 干净基线）；检出优先级 REVISION > VERSION（tag → branch）。env 名与含义见 `SKILL.md` 的表；
// 同步后工作树是「目标提交未打补丁」，必须再跑 patch 与 build；可从任意目录执行。

async function main(): Promise<void> {
  const { value: dirValue, root } = await requireWorkspaceEnv("DEEPSEEK_HARNESS_DIR");
  const version = process.env.DEEPSEEK_HARNESS_VERSION;
  const revision = process.env.DEEPSEEK_HARNESS_REVISION;

  if (!version && !revision) {
    console.error("需要 DEEPSEEK_HARNESS_VERSION 或 DEEPSEEK_HARNESS_REVISION 之一");
    process.exit(1);
  }

  const dir = resolve(root, dirValue);
  const repo =
    process.env.DEEPSEEK_HARNESS_REPO ?? "https://github.com/deepseek-ai/deepseek-harness.git";
  const tag = version ? `dsh-v${version}` : undefined;
  const branch = version ? `dsh-v${version}` : undefined;
  const branchName = `sync/${revision ?? tag ?? "unknown"}`;

  async function shortHead(cwd: string): Promise<string> {
    try {
      return (await execFileCapture("git", ["rev-parse", "--short", "HEAD"], cwd)).trim();
    } catch {
      return "(无 HEAD)";
    }
  }

  async function hasCommit(cwd: string, rev: string): Promise<boolean> {
    try {
      await execFileCapture("git", ["cat-file", "-e", `${rev}^{commit}`], cwd);
      return true;
    } catch {
      return false;
    }
  }

  const refs = [`+refs/tags/*:refs/tags/*`, `+refs/heads/*:refs/remotes/origin/*`];

  if (await pathExists(join(dir, ".git"))) {
    console.log(`[sync] 当前 HEAD: ${await shortHead(dir)}`);
    // 完整 refs fetch：revision 可能指向任意 commit，无法预知属于哪个 tag/branch。
    await runInherited("git", ["fetch", "--prune", "origin", ...refs], dir);
  } else {
    console.log(`[sync] 首次 clone ${repo} -> ${dir}`);
    await runInherited("git", ["clone", repo, dir], root);
  }

  // 清本地残留与旧 patch 修改（目标相同也要 reset——保证 repatch 干净基线）。
  console.log(`[sync] reset --hard @ ${dir}`);
  await runInherited("git", ["reset", "--hard"], dir);

  // 检出目标：REVISION（若有）> VERSION（tag → branch）。
  let used: string;
  let target: string;
  if (revision) {
    target = revision;
    await runInherited("git", ["checkout", "-B", branchName, target], dir);
    used = `revision ${target}`;
  } else if (tag && (await hasCommit(dir, tag))) {
    target = tag;
    await runInherited("git", ["checkout", "-B", branchName, target], dir);
    used = `tag ${tag}`;
  } else if (branch) {
    target = `origin/${branch}`;
    await runInherited("git", ["checkout", "-B", branchName, target], dir);
    used = `branch ${branch}`;
  } else {
    console.error("没有可检出的目标（REVISION / VERSION 均无效）");
    process.exit(1);
  }

  console.log(`[sync] 已检出 ${used} @ ${await shortHead(dir)}`);
  console.log("[sync] 下一步必须运行 patch 脚本（repatch），再 build。");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
