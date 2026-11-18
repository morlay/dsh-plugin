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

clean-dist:
    rm -rf target/dts/*
    pnpm exec -r \
        --filter "./devpackages/*"  \
        --filter "./packages/*/*" \
        rm -rf dist/* 

fmt:
    pnpm exec oxfmt .

# 静态检查：oxlint（含 type-aware 规则）。
# 文档与记录树的三条硬规矩（判据见 `.agents/standards/describing-facts.md`、`.agents/GLOSSARY-MAP.md`）
# 是评审时的约定，没有独立的检查命令。
lint:
    pnpm exec oxlint .

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

# 全仓声明树：生成并落位到各包的 dist（构建与类型图生成共用一份）。
dts:
    pnpm exec node devpackages/dts-prepare/src/cli.ts

# 发布（GitHub Packages）：CI 专用，本地直接跑退 1（见 AGENTS.md 的两条通道）。
publish *args:
    @if [ -z "${GITHUB_ACTIONS:-}" ]; then echo "发布走 CI：本地不发布（见 AGENTS.md）" >&2; exit 1; fi
    pnpm exec node devpackages/devkit/src/release/publish.ts --registry https://npm.pkg.github.com/ {{args}}

# 发布（npmjs）：本地手动，唯一入口。
publish-npm *args:
    pnpm exec node devpackages/devkit/src/release/publish.ts --registry https://registry.npmjs.org/ {{args}}

# 只 bump 发布集合（zephyr 家族同版）；private 包不动。
version *args:
    @for dir in packages/*/*; do \
      if [ -f "$dir/package.json" ] && ! node -e "process.exit(require('./$dir/package.json').private === true ? 0 : 1)"; then \
        (cd "$dir" && pnpm version {{args}} --no-git-tag-version); \
      fi; \
    done

test *args:
    pnpm exec vitest run {{ args }}