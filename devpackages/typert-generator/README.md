# @local/typert-generator

Typert 产物生成器：把上游包的源码与声明树合成 `lib/typert.*.ts`。输入、产物与取舍见
[设计 用 AST 合成 typert 产物](./.agents/designs/20261016-AST合成typert产物.md)；某条规则住在哪个文件见
[规范 how-to-write](./.agents/standards/how-to-write.md)，判据与用例见
[如何验证](./.agents/standards/how-to-verify.md)。

## 用法

```ts
import { generateTypert } from "@local/typert-generator";

await generateTypert({
  upstreamRoot: "vendor/deepseek-harness", // 上游 clone（产物里的 sourceLocation 相对它）
  write: true, // 缺省只返回文本（预演 / 对照）
});
```

声明树（`target/dts`）由本包**直接依赖** `@local/dts-prepare` 自己确保：缺省从 `cwd` 找
仓库根、`ensureWorkspaceDts()` 等声明树就绪、再取 `<root>/target/dts`——与 tsdown 构建
（`repoRootOf(cwd) → ensureWorkspaceDts → dtsRootOf`）同一条流程。调用方不需要先跑单独的 dts 子命令，
也不自己判断声明树在不在；`dtsRoot` 只在对照某一份已生成的声明树或测试里显式传入。

产物三件：`lib/typert.host.ts`（宿主面 TYPERT）、`lib/typert.client.ts`（client 面，双面包才有）、
`lib/typert.remote-client.ts`（远端客户端的 wire 描述 + `declare module` 类型增强）。

预演（不写盘，打印产物）：
`pnpm dlx @oxc-node/cli devpackages/typert-generator/src/cli.ts vendor/deepseek-harness [--dts-root=target/dts] [包名…]`
