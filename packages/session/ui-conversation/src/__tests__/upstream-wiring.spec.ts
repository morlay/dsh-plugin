// fork 只保留「有意改过」的文件，其余跟随上游——每次同步都要逐项判定那是「有意偏离」还是「落后于上游」。
// 这份守卫盯住 **apply 的接线**：对 slots / locale / configForms 这些外部面的订阅，上游挂了的 fork 必须也挂着。
// 漏一条不会报错，只会静默少刷新——实例：0.1.7 同步漏了 `ctx.configForms.developerTools.enabled.subscribe`，
// 于是开发者工具开着也看不到轨迹视图（取值过滤跟着了，触发刷新的订阅没跟）。
// 它不替代行为用例：只保证「接线没漏」，语义对不对仍要人读上游那份。
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const VENDOR =
  "../../../../../vendor/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts";
const UPSTREAM = new URL(VENDOR, import.meta.url);
const FORK = new URL("../client/apply.ts", import.meta.url);

/** 源码里所有 `a.b.c.subscribe(` 的接收者链：键是「谁被订阅」，正是接线的身份。 */
function subscriptions(source: string): Set<string> {
  const found = new Set<string>();
  for (const [, receiver] of source.matchAll(
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.subscribe\(/g,
  )) {
    if (receiver !== undefined) found.add(receiver);
  }
  return found;
}

describe("fork 的 apply 接线跟随上游", () => {
  it("上游挂的订阅，fork 一条不少", async () => {
    const upstream = subscriptions(await readFile(UPSTREAM, "utf8"));
    const fork = subscriptions(await readFile(FORK, "utf8"));
    const missing = [...upstream].filter((receiver) => !fork.has(receiver));
    expect(missing, `上游 apply.ts 挂着的订阅，fork 少了：${missing.join("、")}`).toEqual([]);
  });
});
