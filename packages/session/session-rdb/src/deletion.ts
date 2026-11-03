import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { SessionDeletionError } from "./deletion-error.ts";
import type { SessionPersistenceRdb } from "./session-store.ts";
import { SESSION_DELETE_PATH } from "./routes.ts";
import { HttpError, mountJsonRoute } from "./http/route.ts";

export { SESSION_DELETE_PATH };

const STATUS_OF_DELETION_ERROR: Record<SessionDeletionError["code"], number> = {
  SESSION_NOT_FOUND: 404,
  SESSION_NOT_ARCHIVED: 409,
  SESSION_LIVE: 409,
};

export function registerSessionDeletion(ctx: Context, persistence: SessionPersistenceRdb): void {
  mountJsonRoute(ctx, {
    path: SESSION_DELETE_PATH,
    handle: async (body) => {
      const { sessionId } = body as { sessionId?: unknown };
      if (typeof sessionId !== "string" || sessionId === "") {
        throw new HttpError(400, "missing sessionId field");
      }
      await persistence.deleteSession(sessionId as SessionId);
      return { body: { deleted: sessionId } };
    },
    statusOfError: (error) =>
      error instanceof SessionDeletionError
        ? {
            status: STATUS_OF_DELETION_ERROR[error.code],
            body: { error: error.message, code: error.code },
          }
        : undefined,
  });
}
