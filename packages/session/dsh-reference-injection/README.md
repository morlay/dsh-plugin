# @morlay/dsh-reference-injection

把用户消息里的引用在 `agent/pre-step` 边界展开成注入消息：skill 引用渲染 `<skill_content>`，`@path` 文件引用
读取内容并渲染成 read 工具同形的内容块。引用由 client 面同一份统一解析
（`@morlay/dsh-client-ui-primitives` 的 `findReferences`）认领，消息文本本身不动。

## 行为

- 只扫描本步 claimed 的 `source.kind === 'user'` 消息（外部文本伪造不了这个手势）；
- skill：认领所有引用形态 `skill:name`、`@skill:name`、`[label](skill:name)`、`@[label](skill:name)`；手写的
  inline code（`` `skill:name` ``）由 `parseReferenceToken` 再兜一次；代码块内的同形文本不会命中（解析器保证）；
  名字不在 skill 注册表里、或该 skill 不允许用户调用时保持普通文本；
- 文件：只认 `@` 起手的路径——`@src/a.ts`、`@src/a.ts:12`、`@src/a.ts:12:5`、`@src/a.ts#L12-L40`、
  `@[label](src/a.ts)`、含空格路径的引号 mention `@"my file.ts"`（`@file` 选择器对这类路径就落这一形态）；
  行号决定窗口起点与长度，列号不参与（read 没有列语义）；
- 文件内容经 `ctx.fs` 读取：文件不存在、不是普通文件、读不出（二进制 / 权限）、行号超出文件末尾时保持普通文本；
- 本步所有文件合成**一条**注入消息：第一块是 `<system-reminder>` 说明「这是本步刚读取的最新文件内容，可直接
  使用；同一范围不必再用 read 工具重复读取，需要窗口之外的行时才续读」，其后每个文件一个内容块；
- 内容块与 read 工具逐字同形：`<path>/<type>file</type>/<content>` 信封、行号前缀、续读提示，窗口上限
  （2000 行 / 50 KB / 单行 2000 字符）取 read 的默认值；
- 去重按首次出现顺序（文件按「路径 + 行窗口」去重）；注入消息追加在本步已有注入之后——skill 在前，文件在后；
  消息的 source 是 `{ kind: 'file-reference', references: [...] }`，只列内容真的注入了的引用。

## 装配

部署侧（preset / profile bundle）插入一行即可；本部署的装配在 `@morlay/dsh-preset` 的 bundle patch 里
（`packages/preset/dsh-preset/cordis.patch.yml`）。插件只声明注入 `ctx.skills`；文件内容读取取可选的 `ctx.fs`
——部署里没有文件系统时 skill 注入照常，文件引用保持普通文本。

## 范围

只认 `@` 前缀这一形态——手打的与选择器 pick 归一后落进草稿的都一样，注入不看产生方；skill 同理认
`protocol === 'skill'`。`file:src/a.ts`、`[label](src/a.ts)`、以及 inline code 里的路径都不是注入触发器。解析与
渲染转换的判定见
[ADR-引用的统一解析与渲染转换](../../session/ui-conversation-message-actions/.agents/adrs/20260917-引用的统一解析与渲染转换.md)；
文件内容为什么由本插件按 read 信封自行渲染、为什么只认 `@` 起手，见设计
[文件引用内容注入](./.agents/designs/20260920-文件引用内容注入.md)。
