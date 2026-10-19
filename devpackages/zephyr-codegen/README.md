# @local/zephyr-codegen

bundle 的 `@Module` 元数据 → `cordis.patch.yml` 的最小生成器：`providers` 里的能力包 Provider 生成 insert 行，
官方行的适配 Provider 只生成顶层 config / disabled 行；渲染复用本包 `src/patch.ts` 的同一条规则。

## 用法

bundle 的 `tsdown.config.ts` 把 Module 交给生成器，构建时写回包根的 `cordis.patch.yml`：

```ts
// packages/bundles/<bundle>/tsdown.config.ts
import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatchOf } from "@local/zephyr-codegen";
import { ExampleModule } from "./src/zephyr.module.ts";

export default defineConfig({
  plugins: [cordisPlugin(), bundlePatchOf({ module: ExampleModule, from: import.meta.url }).plugin],
});
```

Module 是唯一装配面，不写 `dsh.rows`、`dsh.packages` 与字符串 id：

```ts
@Module({
  providers: [
    WebSearchOllama.withConfig({ apiKeyEnv: "OLLAMA_API_KEY" }),
    LlmPiAi.withConfig({ providers: { ollama: { ... } } }),
    Web.withConfig({ searchProvider: "ollama", fetchProvider: "http" }),
  ],
})
export class OllamaProviderProfileModule {}
```

生成结果：

```yaml
- insert:
    - id: web-search-ollama
      name: "@morlay/dsh-web-search-ollama/cordis-register"
- id: llm-pi-ai
  config:
    providers: ...
- id: web
  config:
    searchProvider: ollama
    fetchProvider: http
- id: web-search-ollama
  config:
    apiKeyEnv: OLLAMA_API_KEY
```

官方插件的适配 Provider（`LlmPiAi` / `Web`）来自 `@morlay/dsh-base` / `@morlay/dsh-web-app` 的 `fromCordis` 包装：
它们带 `static providerName`（上游插件名），因此行 id 从插件名派生，只覆盖 config、不 insert——行本身由上游 patch 提供。

## 元数据形状

| 事实            | 从哪读                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| 行 id（能力包） | Provider token 名按 zephyr 的 hyphenate 规则；`configuredProvider` 子类带 `providerName`                    |
| 行 id（官方行） | 适配类的 `adapted` + 类名（`@deepseek-ai/dsh-web` 的 `WebRuntime` → `web`）                                 |
| 行包名          | 能力包：Provider 定义文件（`@Injectable()` 记录的 `providerFile`）向上找到的 `package.json`；官方行不取包名 |
| insert 行       | `providers` 里的能力包 class（`withConfig()` 的配置子类带 `providerConfig`）                                |
| 顶层 config 行  | 配置子类的 `providerConfig`，或 `{ provide, useValue }` 的 `useValue`                                       |
| disabled 行     | `without(provider[, expr])` 的标记                                                                          |
| 顺序            | disabled 行在前，随后 insert 块（按 providers 声明），最后是 config 行                                      |
| 旧 `dsh.rows`   | 兼容：`{ id, disabled }` / `{ id, config }` / `"insert"` 占位                                               |

`@Module` 读的是 `Symbol.for("zephyr.module")`，与 zephyr `core.ts` 的 `kModule` 同一个 symbol；本包的
`defineModule()` 是与 `@Module()` 同形的最小实现（测试与没有 zephyr 的调用方用），真实 bundle 直接用
zephyr 的装饰器即可。

## 设计取舍

- **Module 由调用方 `import()`，生成器不自己加载文件**：仓库已在 `pnpm-workspace.yaml` 的 `nodeOptions`
  挂 oxc 注册，bundle 的 TS Module 与能力包走同一条加载路径；生成器只接收类，读元数据的行为与未来运行期
  读 Module 的行为一致。
- **不用 `vm` + oxc transform**：`vm` 要自己拼 transform、bare specifier 解析与 `exports` 条件，拿到的类
  还是另一份模块实例（装饰器注册表、`instanceof`、静态字段都不共享）；收益只是不执行 Module 的顶层
  副作用，而 Module 目前只有类与常量声明。等出现「Module 顶层不能执行」的真实需求再换。
- **不 import zephyr**：zephyr 的 `getTokenName` 依赖 token 注册表，`hyphenate` 本身没从包出口暴露；
  devpackage 也不该为一个纯函数依赖发布包。hyphenate 规则在本包复制一份（`src/hyphenate.ts`），用
  `src/__tests__/hyphenate.spec.ts` 钉住。
- **行名不手写**：能力包的包名从 Provider 定义文件所属的 `package.json` 推导（`@Injectable()` 记录定义
  文件），调用方仍可用 `packageNameOf` / `packageNameOfRow` 覆盖。
- **Config 显式，不从 Provider 推导**：`withConfig()` 把 config 写在装配面；生成器不读 Provider 的
  Config schema、也不猜默认值。
- **不生成 bundle 的 `index.ts`**：bundle 是装配数据的载体、不是运行期插件，能力包入口由 `toCordis` 在
  运行期转换（见 [双向适配与 dsh 行装配](../../packages/zephyr/zephyr/.agents/designs/20261019-双向适配与dsh行装配.md)）。
- **渲染不另起炉灶**：行清单交给本包 `src/patch.ts` 的 `renderPatch` / `generatePatch`，与手写 bundle
  的产物用同一份 YAML dialect（`!!js` 表达式、头注释）。

## 已知缺口（都按错误暴露，不静默丢行）

- **Provider 必须能定位到包**：没有 `@Injectable()`（也就没有 `providerFile`）又没传 `packageNameOf` 时
  直接抛错，不猜包名。
- **multi contribution 没有行表达**：一个 insert 行只挂一个 Provider；多贡献（`contribute()`）在生成
  patch 前没有对应的行语义，直接抛错。
- **行 id 覆盖**：能力包类名与期望 id 不同时只能靠 `static providerName`。

## 验证

```sh
pnpm exec vitest run devpackages/zephyr-codegen
```
