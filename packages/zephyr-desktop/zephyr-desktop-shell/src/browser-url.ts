// 面板能浏览什么：**只有 http / https**。
//
// 为什么是白名单而不是黑名单：面板里的页面跟主页面共享同一个进程（虽然不同 session 分区），
// `javascript:` 会在这条链上执行脚本、`file:` 能读磁盘、`data:`/`about:` 能绕过「这是一次网络导航」的
// 语义。判据写在**主进程**这一侧（渲染进程只发 `navigate` 意图），所以绕不过去。
/** 面板允许的协议（其余一律拒）。 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * 这个地址能不能放进面板。
 * @param url - 用户输入的或页面要求的地址。
 * @returns 能不能（解析不出来就是不能）。
 */
export function browserUrlAllowed(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
