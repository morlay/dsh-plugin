// 测试专用出口（`@morlay/zephyr-dev/testing`）：只给**测试**用，不进主出口。
//
// **按包出口取**，不写 `../federation/…` 这类跨目录相对路径：`testing` 是一个子出口面，
// 面里的相对 `../` 会让"面"退化成目录结构的一部分（改文件布局就破面向外契约）。
export * from "@morlay/zephyr-dev";
export * from "@morlay/zephyr-dev/node";
