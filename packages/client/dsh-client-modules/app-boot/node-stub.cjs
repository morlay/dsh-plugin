// 联邦构建（rolldown，CJS 产物）用的 `node:*` 替身。
//
// 与同目录的 `node-stub.ts`（dev 逐文件服务用的 ESM 形态）**同一语义**：这些 API 在浏览器里本不该被
// 调用，但模块求值不该中断。形态为什么要分两份：ESM 的具名导入在构建期要**校验存在性**（缺了就
// `MISSING_EXPORT`），而 CJS 不校验——联邦产物的 `require("node:fs")` 需要的就是后者。
//
// 缺了这个文件时，构建报的是 `UNLOADABLE_DEPENDENCY`，整包构建失败、页面上那一路直接 404。
module.exports = {
  Readable: class {},
  Writable: class {},
  Duplex: class {},
  Transform: class {},
  PassThrough: class {},
  pipeline: (...args) => {
    const done = args.at(-1);
    if (typeof done === "function") done();
  },
  promises: {},
};
