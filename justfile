mod vendor 'vendor/justfile'
# mod pg 'packages/session/session-rdb/tool/pg/justfile'
mod custom 'apps/dsh-custom-next/justfile'

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
