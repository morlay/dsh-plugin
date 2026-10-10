import type { SessionStore } from "@deepseek-ai/dsh-session";

declare module "@deepseek-ai/cordis" {
  interface Context {
    sessions: SessionStore;
  }
}

export type Probe = SessionStore;
