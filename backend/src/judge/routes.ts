import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { requireStaff, staffOf } from "../auth/middleware.ts";
import type { AuthDeps } from "../auth/staff.ts";
import { AppError } from "../http/errors.ts";
import { requestIdOf } from "../http/request-id.ts";
import { getEntryForReview, listAssignedEntries, mintPlaybackUrl, saveScore, saveScoreSchema } from "./entries.ts";

const notFound = () => new AppError(404, "not_found", "Not found.");
const entryCodeOf = (value: unknown): string => {
  if (typeof value !== "string" || !/^[A-Z0-9]{6,16}$/u.test(value)) throw notFound();
  return value;
};

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "body";
    fields[path] ??= issue.message;
  }
  throw new AppError(400, "invalid_request", "Validation error");
}

export function judgeRouter(deps: AuthDeps): Router {
  const router = Router();
  const judge = requireStaff(deps, { roles: ["judge"] });
  const now = () => deps.now();
  const actor = (res: Response) => ({ judgeId: staffOf(res).staffId, requestId: requestIdOf(res) });

  const guarded = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };

  router.get("/entries", ...judge, guarded(async (_req, res) => {
    res.json(await listAssignedEntries(deps.db, staffOf(res).staffId));
  }));

  router.get("/entries/:entryCode", ...judge, guarded(async (req, res) => {
    const code = entryCodeOf(req.params.entryCode);
    res.json({ entry: await getEntryForReview(deps.db, staffOf(res).staffId, code) });
  }));

  router.post("/entries/:entryCode/playback", ...judge, guarded(async (req, res) => {
    const code = entryCodeOf(req.params.entryCode);
    res.json(await mintPlaybackUrl(deps.db, now(), actor(res), code));
  }));

  router.put("/entries/:entryCode/score", ...judge, guarded(async (req, res) => {
    const code = entryCodeOf(req.params.entryCode);
    const body = parse(saveScoreSchema, req.body);
    res.json(await saveScore(deps.db, now(), actor(res), code, body));
  }));

  return router;
}

