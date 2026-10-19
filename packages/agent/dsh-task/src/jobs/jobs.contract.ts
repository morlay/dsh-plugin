// 后台任务契约：令牌按服务语义命名（上游注册名 `jobs`）。
import { Injectable } from "@morlay/zephyr";

interface JobsFace {}

@Injectable()
export abstract class Jobs implements JobsFace {}
