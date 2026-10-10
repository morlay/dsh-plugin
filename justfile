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

clean:
    rm -f pnpm-lock.yaml;
    pnpm clean

fmt:
    pnpm exec oxfmt .

lint:
    pnpm exec oxlint .

publish:
    pnpm -r --filter './packages/*/*' --workspace-concurrency=1 exec node --import={{ join(justfile_directory(), 'devpackages/devkit/src/ts-loader.mjs') }} {{ justfile_directory() }}/scripts/publish-if-need.mts

# 插件包构建：`@deepseek-ai/*` 经 exports 指到 src 后，tsdown 加载 config（→ @local/devkit → 上游源码）
# 需要 TS loader 转译（Node 原生 strip-only 不支持 parameter properties / 枚举 / 装饰器）。
build *args:
    @NODE_OPTIONS="--import={{ join(justfile_directory(), 'devpackages/devkit/src/ts-loader.mjs') }}" pnpm -r --filter './packages/*/*' run build {{ args }}

version *args:
    pnpm -r --filter './packages/*/*' version {{ args }}

test:
    pnpm exec vitest run
