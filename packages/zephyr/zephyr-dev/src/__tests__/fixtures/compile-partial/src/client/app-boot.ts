// 只引用一个已知包（`@morlay/zephyr-app`）：清单非空但缺 REQUIRED 里的另外两个，
// `compile()` 必须在**构建前**就点名报错（不跑真打包）。
import "@morlay/zephyr-app/client";

export const boot = 1;
