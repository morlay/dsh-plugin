import { Module } from "@morlay/zephyr";
import { SessionControllerDefault, SessionLogDownload, SessionReference, SessionStats, SessionTurnOutline } from "./session.service.ts";

@Module({ providers: [SessionLogDownload, SessionReference, SessionStats, SessionTurnOutline, SessionControllerDefault] })
export class SessionModule {}
