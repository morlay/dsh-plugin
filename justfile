mod vendor 'vendor/justfile'
# mod pg 'packages/zephyr/zephyr-rdb/tool/pg/justfile'
mod custom 'apps/zephyr-custom/justfile'

default:
    just --list

mise *args:
    mise {{ args }}

view *args:
    pnpm view {{ args }}

dep *args:
    pnpm install {{ args }}

update:
    pnpm dlx -r \
        --filter "./devpackages/*"  \
        --filter "./packages/*/*" \
        taze latest -w

prepare:
    just vendor sync
    just vendor patch
    just dep
    just vendor prebuild

clean:
    rm -f pnpm-lock.yaml;
    pnpm clean

# 删**整棵**声明树（不是它的内容）：完成标记 `target/dts/.complete` 是隐藏文件，
# `rm -rf target/dts/*` 会把它留下，于是下一次构建以为声明树还在。
clean-dist:
    rm -rf target/dts
    pnpm exec -r \
        --filter "./devpackages/*"  \
        --filter "./packages/*/*" \
        rm -rf dist/* 

fmt:
    pnpm exec oxfmt .

# 静态检查：oxlint（含 type-aware 规则）+ oxfmt --check（格式与文件结尾换行）。
# 能机器判的都在这里；`.agents/standards/*` 只写规矩本身，不再重复「怎么查」。
# 文档与记录树里**机器判不了**的那部分（措辞有没有过期、事实有没有重复）见 `just audit` 的对应判据。
lint:
    pnpm exec oxlint .
    pnpm exec oxfmt --check .

# **逐包跑、根上汇总**：单包的判据（面边界、声明未用、本包用到的上游「面」、值边与双断言）由
# `pnpm -r exec` 在各包目录里做；唯一化是跨包的（同一上游包的同一个面只能有一个本地 owner），
# 由汇总器判。
#
# **走 pnpm 的 task graph**：包列表由 pnpm 的递归决定，**不另找一份**——`find`/`xargs` 那种绕行会把
# "workspace 有环、pnpm 拒跑"变成"汇总器读到空输入"，判据假绿；汇总器对空输入直接退出 1 兜底。
#
# 结构性判据（面边界 / 唯一化 / 声明未用 / 扩展边界 / 类型纪律）：有违规退出 1。
audit *args:
    pnpm exec devkit audit {{args}}

# 各包构建（tsdown）：发布前的产物由它生成（`just lint` / `just test` 不依赖它）。
build *args:
    pnpm exec devkit build {{ args }}

# 全仓声明树的**手动重建入口**：生成并落位到各包的 dist。正常流程不用跑它——`just build`
# 里的 `devkit build` 会自己确保声明树（进程锁、跨进程只生成一次）。
dts:
    pnpm exec node devpackages/dts-prepare/src/cli.ts

# 发布（GitHub Packages）：CI 专用，本地直接跑退 1（见 AGENTS.md 的两条通道）。
publish *args:
    @if [ -z "${GITHUB_ACTIONS:-}" ]; then echo "发布走 CI：本地不发布（见 AGENTS.md）" >&2; exit 1; fi
    pnpm exec node devpackages/devkit/src/release/publish.ts --registry https://npm.pkg.github.com/ {{args}}

# 发布（本地模拟 registry / npmjs）：本地手动，唯一入口。
#
# **默认地址是本地模拟 registry（`tool/npr` 的 verdaccio，`http://127.0.0.1:7677/`），不是 npmjs**：
# 不带 `--registry` 时 `publish.ts` 自己落在这个地址上，所以手滑跑一条 `just publish-npm` 只会发到本机，
# 碰不到真 registry。
#
# 演练：`--dry-run` 看包名 / 版本 / dist-tag；`--force-republish` 覆盖本地同名同版本（先 unpublish 再
# publish，只对 loopback 开放）。起本地 registry 见 [tool/npr](./tool/npr/README.md)。
#
# 一句话：不带 `--registry` 只发到本机；真发 npmjs 必须写 `--registry https://registry.npmjs.org/`。
publish-npm *args:
    pnpm exec node devpackages/devkit/src/release/publish.ts {{ args }}

# 发布前验收（票据 06）：清单覆盖 / private 分档 / tarball 内容 / 出口加载冒烟 / dry-run。
# 人工门：不进 prepare / lint / test / build / CI；只读 registry（`pnpm view` / `pnpm pack`），不 publish。
verify-release *args:
    pnpm exec node devpackages/devkit/src/release/acceptance.ts {{ args }}

# 只 bump 发布集合（zephyr 家族与插件同版）；private 包不动。
#
# **显式跳过 `packages/boot/dsh-oxc-node`**：它是 `private: false` 的既有公开包，但走**独立版本线**
# （`.agents/designs/20261118-npm发布线.md` 决定 8：首发须高于 npm 现有 `0.2.13`），
# 只按 `private` 判会把它一起降到家族版本上；它的版本单独改。
#
# **不要求干净树**：本配方是发版前的本地 bump，树里有未提交改动是常态，pnpm 默认会直接
# `ERR_PNPM_UNCLEAN_WORKING_TREE`——所以带 `--no-git-checks`（只跳过工作树检查，语义就是「本地
# 版本 bump 不挑树」）。`--no-git-tag-version` 保证不建提交与 tag，提交由人写。
version *args:
    @for dir in packages/*/*; do \
      case "$dir" in packages/boot/dsh-oxc-node) continue ;; esac; \
      if [ -f "$dir/package.json" ] && ! node -e "process.exit(require('./$dir/package.json').private === true ? 0 : 1)"; then \
        (cd "$dir" && pnpm version {{args}} --no-git-tag-version --no-git-checks); \
      fi; \
    done

test *args:
    pnpm exec vitest run {{ args }}