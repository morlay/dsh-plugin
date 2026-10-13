mod vendor 'vendor/justfile'
mod pg 'packages/session/session-rdb/tool/pg/justfile'
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
        --filter 'dsh-plugin' \
        --filter './packages/*' \
        --filter './devpackages/*' \
        taze latest -w

prepare:
    just vendor sync
    just vendor patch
    just dep
    just vendor prebuild

clean:
    rm -f pnpm-lock.yaml;
    pnpm clean

fmt:
    pnpm exec oxfmt .

lint:
    pnpm exec oxlint .

publish:
    pnpm -r --filter './packages/*/*' --workspace-concurrency=1 exec node {{ justfile_directory() }}/scripts/publish-if-need.mts

# 全仓声明（一步、两个 face）：生成到 target/dts，各包构建只按路径取自己的那份来合并。
# 插件包构建：`@deepseek-ai/*` 经 exports 指到 src 后，tsdown 加载 config（→ @local/devkit → 上游源码）
# 需要 TS 转译（Node 原生 strip-only 不支持 parameter properties / 枚举 / 装饰器）——由 pnpm-workspace.yaml
# 的 `nodeOptions` 统一挂 oxc 注册，这里不再写 `--import`。
build *args:
    pnpm -r --filter './packages/*/*' run build {{ args }}

version *args:
    pnpm -r --filter './packages/*/*' version {{ args }}

test:
    pnpm exec vitest run
