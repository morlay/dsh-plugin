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

# 结构性判据：面边界 / 上游包唯一化 / 声明未用依赖。有违规退出 1。
#
# **逐包跑、根上汇总**：单包的判据（面边界、声明未用、本包用到的上游「面」）由 `pnpm -r exec` 在
# 各包目录里做；唯一化是跨包的（同一上游包的同一个面只能有一个本地 owner），由汇总器判。
audit *args:
    # 逐包跑：**不经过 pnpm 的 task graph**——workspace 有循环依赖时它会直接拒跑，汇总器读到空输入
    # 就会"三项全绿"（判据假绿）。包列表用 find 拿，与 pnpm 的依赖图无关。
    @bash -c 'root="$PWD"; for dir in $(find packages -mindepth 3 -maxdepth 3 -name package.json -not -path "*/node_modules/*" | xargs -n1 dirname | sort); do (cd "$dir" && node "$root/devpackages/audit/src/package-audit.ts"); done | pnpm exec dsh-audit-report {{args}}'

# 发布一律走 CI（见 `AGENTS.md` 红线：严禁本地 publish）。这一条只把红线说出来。
publish:
    @echo "发布走 CI：本地不发布（AGENTS.md 红线）" && exit 1

# 各包构建（tsdown）：发布前的产物由它生成（`just lint` / `just test` 不依赖它）。
build *args:
    pnpm -r --filter './packages/*/*' run build {{ args }}

version *args:
    pnpm -r --filter './packages/*/*' version {{ args }}

test *args:
    pnpm exec vitest run {{ args }}