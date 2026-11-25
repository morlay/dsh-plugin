mod vendor 'vendor/justfile'
# mod pg 'packages/zephyr/zephyr-rdb/tool/pg/justfile'
mod custom 'apps/zephyr-custom/justfile'
mod dsh 'apps/dsh/justfile'

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

# 删声明树与各包 dist。
clean-dist:
    pnpm exec devkit clean

fmt:
    pnpm exec oxfmt .

# 静态检查：oxlint 单进程扫全仓（含 type-aware 规则；`.oxlintrc.json` 的 ignorePatterns 已排除 `vendor/**`）。
# 格式（`oxfmt --check`）不进这道门：它是提交前的本地习惯。
lint:
    pnpm exec oxlint .

# 结构性判据（面边界 / 唯一化 / 声明未用 / 扩展边界 / 类型纪律）：有违规退出 1。
# 逐包跑、根上汇总；包列表由 pnpm 的递归给出，不在这里另找一份。
audit *args:
    pnpm exec devkit audit {{args}}

# 各包构建：产物、声明与清单写回都在这一步。
build *args:
    pnpm exec devkit build {{ args }}

# 全仓声明树的手动重建入口：正常流程不用跑它（`just build` 会自己确保）。
dts:
    pnpm exec node devpackages/dts-prepare/src/cli.ts

# 发布（GitHub Packages）：CI 专用，本地恒 exit 1（见 AGENTS.md 的三条通道）。
publish *args:
    pnpm exec devkit publish --github {{args}}

# 发布（本地模拟 registry / npmjs）：本地手动，唯一入口。
#
# 默认落到本地模拟 registry（`tool/npr` 的 verdaccio，http://127.0.0.1:7677/）；真发 npmjs 必须显式
# `--registry https://registry.npmjs.org/`。`--dry-run` 看包名 / 版本 / dist-tag；`--force-republish`
# 覆盖本地同名同版本（只对 loopback 开放）。
publish-npm *args:
    pnpm exec devkit publish {{ args }}

# 发布前验收（判据 2 / 7 / 8 / 9 / 10）：人工门，不进 prepare / lint / test / build / CI。
verify-release *args:
    pnpm exec devkit verify-release {{ args }}

# 只 bump 发布集合（zephyr 家族与插件同版）；`dsh-oxc-node` 走独立版本线，不随家族版本。
version *args:
    pnpm exec devkit version {{ args }}

# 测试：两层（`node` / `ui`）由 `vitest.config.ts` 的 projects 决定；环境靠文件名——
# `*.spec.dom.ts` / `*.spec.dom.tsx` → happy-dom，其余 `*.spec.ts` → node。
# 单跑一层：`just test --project ui`；按路径过滤：`just test packages/zephyr/zephyr-ui`。
test *args:
    pnpm exec vitest run {{ args }}

