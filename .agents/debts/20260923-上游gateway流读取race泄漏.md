# 上游 gateway 长寿命流上的 `Promise.race` 反应累积（本地 patch 接管）

状态：未销账（等上游修掉后删除本地 patch；上游 issue 待补 URL，报告草稿是本地临时产物
`.scratch/20260923-gateway-stream-promise-race-leak.md`，不进仓库、故这里不给链接）

**现象**

桌面宿主（`dsh-custom-next-server`）的内存随工作时长单调上涨且**收不回来**：`footprint`
一小时量级从 ~340 MB 爬到 ~900 MB+，而强制 major GC（`HeapProfiler.collectGarbage`，188 ms）
只回收 4.9 MB / 495 MB —— 对象是**可达**的。V8 `old_space.used` 单调上涨、从不回落；
`RSS` 在 41 MB … 1.2 GB 之间乱跳（页进了 compressor），所以只有 `footprint` 与
`heap space` 能看出问题。

存活分配采样（`HeapProfiler.startSampling`，32 KB 间隔，170 秒）把 60.3 MB / 70.5 MB（85%）
的存活字节归到同一条栈：

```
(root) <- processTicksAndRejections <- (anonymous)
       <- (anonymous) (@morlay/dsh-desktop-host/lib/index.js:148)   // streamHandler 的请求处理器
       <- next <- cancellableStream (api/gateway/lib/index.js:1244) <- race
```

**根因**（`@deepseek-ai/dsh-api-gateway@0.1.7-alpha.2`）

`cancellableStream`（`src/index.ts` ~1167）与 `UplinkDecoder.next()`（~1212 / ~1240）都在
循环里 `Promise.race([work, cancelPromise])`，而那个取消分支的生命周期是**整条流**
（`aborted` 只在 abort 时 reject；`interrupted` 只在 `finish()` / abort 时 settle）。V8 只在
promise 自身 settle 时才摘掉败方分支的 reaction，于是**每读一项就在那个长寿命 promise 上留下
一个 reaction**，流只要活着（桌面 `/.dsh/remote-stream` 的 `$events` 类流活一整个会话）就永不释放。
实测 ~12–15 MB/min，与读取次数成正比、与真正的载荷体量无关（10 分钟 368 个事件仅 0.88 MB 数据，
同期堆涨 77 MB）。

**处置：本地 patch，不改上游包**

- [`patches/gateway-stream-race-leak.patch`](../../patches/gateway-stream-race-leak.patch)：
  把取消分支改成**每轮迭代一个** promise（`new Promise` + `abort` 监听，迭代结束在 `finally` 里
  `removeEventListener`），因此迭代一结束该 promise 连同其 reaction 就不可达；abort 语义不变
  （`signal.aborted` 时立即 reject，并加一句 `void x.catch(...)` 防「race 尚未订阅就 abort」的
  unhandled rejection）。
- [`patches/steps.json`](../../patches/steps.json) 第三条登记该步骤（`patch.ts` 的 `git apply`）。
- patch 改的是上游内部实现（局部变量与私有字段），语义按「同一时刻只有一个 `next()` 在飞」保持。

**影响**

- 撞上的是桌面宿主的长会话：内存随时间攀升且回落不了（数字见**现象**），最终只能重启宿主；
  跑一整天就是一路涨上去。
- 影响面不限于桌面形态：泄漏由**读取次数**驱动，任何「一条流活很久 + 项很多」的调用方都同样中招，
  桌面形态只是眼下唯一这种调用方。

**触发条件**

- **升级即信号**：`git apply` 失败就说明上游动过这两处（`cancellableStream` / `UplinkDecoder.next()`），
  必须先重新评估本 patch。
- **生效前提**：改的是 `src/`，运行期加载的是 `lib/`——必须重建（`just vendor build`）**并重启宿主**，
  否则看到的还是旧行为。
- 动桌面 host 的流处理（`/.dsh/remote-stream` 的 `streamHandler`）之前。

**销账条件**

Done when：升级上游后不再需要这个 patch——上游已把取消分支的生命周期压到一轮迭代内（或换掉这处
`Promise.race`）；届时删除 [`patches/gateway-stream-race-leak.patch`](../../patches/gateway-stream-race-leak.patch)、
`patches/steps.json` 第三条与本记录。

**不修的理由**

- 上游包不可修改（红线），只能以本地 patch 形式接管。
- 这是**上游缺陷的临时接管**，不是我们的扩展面选择：能走插件层的都不该打 patch，此处上游代码
  内部没有可插入的接缝（问题在它自己的读取循环里）。
- patch 的语义正确性有上游活文档兜底（`vendor/deepseek-harness/packages/api/gateway/tests/*stream*.spec.ts`）。
