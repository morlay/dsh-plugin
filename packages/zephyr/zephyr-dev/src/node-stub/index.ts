/**
 * 浏览器里的 `node:*` 替身。
 *
 * 宿主半的代码有时被**同包的相对导入**拖进 client 图（典型是 `client/connection` 的 client 半引到
 * `src/loopback-hostname.ts`、再链到 `src/http-bridge.ts`，那里 `import { Readable } from 'node:stream'`）。
 * vite 默认把 `node:*` 换成 browser-external 代理，**读取成员时抛错**，于是一整条入口求值中断——页面白屏
 * 且只有一条难以归因的报错。这里给出求值安全的空实现：这些 API 在浏览器里本不该被调用，但模块求值不应中断。
 *
 * **两份形态、同一语义**：dev 形态逐文件服务，缺失的具名导入只是 undefined（运行期），这份 ESM 够用；
 * 联邦构建走 rolldown，它把"没有该具名导出"当**构建错误**（`MISSING_EXPORT`），那里得用 CJS 形态的
 * `node-stub.cjs`——CJS 的具名导入不校验存在性。
 */
export class Readable {}
export class Writable {}
export class Duplex {}
export class Transform {}
export class PassThrough {}
export const pipeline = (...args: unknown[]): void => {
  const done = args.at(-1);
  if (typeof done === "function") (done as () => void)();
};
export const promises = {};
export default { Readable, Writable, Duplex, Transform, PassThrough, pipeline, promises };
