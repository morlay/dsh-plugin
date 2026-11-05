# dsh-custom-next

本仓的 MVP 部署面：`just custom web` 起的就是它。

- 装配清单：[`src/zephyr.provide.ts`](./src/zephyr.provide.ts)（`customProvidersOf(features)`，顺序即装配顺序）
- 客户端清单：[`src/client/index.ts`](./src/client/index.ts)
- 入口：[`src/main.ts`](./src/main.ts)（只做「推导行清单 → `bootstrapApplication`」，外加服务端 HMR）

## `package.json` 里的上游依赖**不要按"未 import"删**

`dependencies` 里那几十个 `@deepseek-ai/dsh-*` / `@deepseek-ai/dsh-client-*` 在 `src/` 里没有一条 `import`
——它们不是给源码用的，是给**前端模块解析**用的锚点：vite 侧把 `/_zephyr/@modules/<pkg>` 交给
`createRequire(<app>/package.json)` 解析，上游包自己的第三方依赖（`zustand` / `immer` / `shiki` /
`schemastery` / `@deepseek-ai/dsh-util-file-drag` …）只能从"引它的那个包"的清单里看见。

删掉它们会安静地 404，直到某个上游组件在浏览器里 `import` 时才炸。判据是**模块图**，不是 import 扫描：

```
curl -s http://127.0.0.1:3080/app-boot.ts   然后递归跟 import
```

（删过一次：`@deepseek-ai+dsh-util-file-drag` 与 `@deepseek-ai+schemastery` 立刻 404，随后回滚。）
