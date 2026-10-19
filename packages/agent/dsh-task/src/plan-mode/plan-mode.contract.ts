// 计划模式契约：令牌按服务语义命名（上游注册名 `planMode`）；公开面由插件按需提供。
import { Injectable } from "@morlay/zephyr";

interface PlanModeFace {}

@Injectable()
export abstract class PlanMode implements PlanModeFace {}
