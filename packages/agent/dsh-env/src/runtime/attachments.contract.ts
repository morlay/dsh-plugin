// 附件存储契约：令牌按服务语义命名（上游注册名 `attachments`）。
import { Injectable } from "@morlay/zephyr";

interface AttachmentsFace {}

@Injectable()
export abstract class Attachments implements AttachmentsFace {}
