import { Module } from "@morlay/zephyr";
import { MessageFeedback } from "./feedback.service.ts";

@Module({ providers: [MessageFeedback.withConfig({ "maxNoteBytes": 8192 })] })
export class FeedbackModule {}
