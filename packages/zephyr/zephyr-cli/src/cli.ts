#!/usr/bin/env node
// bin 入口：只负责取 argv 与设置退出码，逻辑全在 `./run.ts`（那一个文件可在测试里直接调）。
import { runCli } from "./run.ts";

process.exitCode = await runCli(process.argv.slice(2), { cwd: process.cwd() });
