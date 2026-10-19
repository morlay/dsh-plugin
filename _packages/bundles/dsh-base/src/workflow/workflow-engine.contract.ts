// workflow 引擎契约：令牌按服务语义命名（上游注册名 `workflowEngine`）。
import { Injectable } from "@morlay/zephyr";

interface WorkflowEngineFace {}

@Injectable()
export abstract class WorkflowEngine implements WorkflowEngineFace {}
