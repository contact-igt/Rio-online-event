import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { requireStaff, staffOf } from "../auth/middleware.ts";
import { ROLES } from "../auth/roles.ts";
import type { AuthDeps } from "../auth/staff.ts";
import { AppError } from "../http/errors.ts";
import { requestIdOf } from "../http/request-id.ts";
import { loadDashboard } from "./dashboard.ts";
import {
  addQuestion, asRuleViolation, createDraft, createSetBody, deleteQuestion, discardDraft, FieldsInvalid, getSet, listCompetitions, listSets, previewSet, publishBody, publishSet,
  questionBody, reorderBody, reorderQuestions, updateQuestion,
} from "./questions.ts";
import { listQuery, listRegistrations, loadRegistration } from "./registrations.ts";
import { loadSettings, patchBody, present, SettingsInvalid, updateSettings } from "./settings.ts";

// Mounted under /api/v1/admin. Administrators only: requireStaff checks the origin, the session, the role (read from the database) and, for every
// request that changes something, the CSRF token. A judge and an anonymous caller get the same refusals as on every staff route.
//   GET /dashboard, GET and PATCH /settings                                         (M5A)
//   GET /registrations (filters: competition, status, page), GET /registrations/:entryCode   (read only; opening one is audited)
//   GET /competitions, GET and POST /competitions/:slug/question-sets               (M5B)
//   GET and DELETE ../question-sets/:setId, GET ../:setId/preview, POST ../:setId/publish
//   POST ../:setId/questions, PATCH and DELETE ../:setId/questions/:questionId, PUT ../:setId/order

const notFound = () => new AppError(404, "not_found", "Not found.");
const slugOf = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 60 || !/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(value)) throw notFound();
  return value;
};
const idOf = (value: unknown): number => {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,11}$/u.test(value)) throw notFound();
  return Number(value);
};

/** Strict parse. A failure reports field codes only, never the text that was typed. */
function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "body";
    fields[path] ??= /^[a-z_]+$/u.test(issue.message) ? issue.message : "invalid";
  }
  throw new FieldsInvalid(fields, 400, "invalid_request");
}

export function adminRouter(deps: AuthDeps): Router {
  const router = Router();
  const admin = requireStaff(deps, { roles: ROLES.adminApi });
  const now = () => deps.now();
  const actor = (res: Response) => ({ staffId: staffOf(res).staffId, requestId: requestIdOf(res) });
  const guarded = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof SettingsInvalid || error instanceof FieldsInvalid) {
        res.status(error.status).json({ error: { code: error.code, message: error.message, fields: error.fields, requestId: requestIdOf(res) } });
        return;
      }
      next(asRuleViolation(error) ?? error);
    }
  };

  router.get("/dashboard", ...admin, guarded(async (_req, res) => void res.json(await loadDashboard(deps.db, now()))));
  router.get("/settings", ...admin, guarded(async (_req, res) => void res.json(present(await loadSettings(deps.db), now()))));
  router.patch("/settings", ...admin, guarded(async (req, res) => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "invalid_request", "The request could not be understood.");
    res.json(await updateSettings(deps.db, now(), actor(res), parsed.data));
  }));

  router.get("/registrations", ...admin, guarded(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, "invalid_request", "The request could not be understood.");
    res.json(await listRegistrations(deps.db, parsed.data));
  }));
  router.get("/registrations/:entryCode", ...admin, guarded(async (req, res) => {
    const code = req.params.entryCode;
    if (typeof code !== "string" || !/^[A-Z0-9]{6,16}$/u.test(code)) throw notFound();
    res.json({ registration: await loadRegistration(deps.db, now(), actor(res), code) });
  }));

  const sets = "/competitions/:slug/question-sets";
  const slug = (req: { params: Record<string, unknown> }) => slugOf(req.params.slug);
  const setId = (req: { params: Record<string, unknown> }) => idOf(req.params.setId);
  router.get("/competitions", ...admin, guarded(async (_req, res) => void res.json({ competitions: await listCompetitions(deps.db) })));
  router.get(sets, ...admin, guarded(async (req, res) => void res.json(await listSets(deps.db, slug(req)))));
  router.post(sets, ...admin, guarded(async (req, res) => {
    const body = parse(createSetBody, req.body ?? {});
    res.status(201).json(await createDraft(deps.db, now(), actor(res), slug(req), body.startFrom));
  }));
  router.get(`${sets}/:setId`, ...admin, guarded(async (req, res) => void res.json(await getSet(deps.db, slug(req), setId(req)))));
  router.delete(`${sets}/:setId`, ...admin, guarded(async (req, res) => {
    await discardDraft(deps.db, now(), actor(res), slug(req), setId(req));
    res.status(204).end();
  }));
  router.get(`${sets}/:setId/preview`, ...admin, guarded(async (req, res) => void res.json(await previewSet(deps.db, slug(req), setId(req)))));
  router.post(`${sets}/:setId/questions`, ...admin, guarded(async (req, res) => {
    res.status(201).json(await addQuestion(deps.db, now(), actor(res), slug(req), setId(req), parse(questionBody, req.body)));
  }));
  router.put(`${sets}/:setId/order`, ...admin, guarded(async (req, res) => {
    const { order } = parse(reorderBody, req.body);
    res.json({ questions: await reorderQuestions(deps.db, now(), actor(res), slug(req), setId(req), order) });
  }));
  router.patch(`${sets}/:setId/questions/:questionId`, ...admin, guarded(async (req, res) => {
    res.json(await updateQuestion(deps.db, now(), actor(res), slug(req), setId(req), idOf(req.params.questionId), parse(questionBody, req.body)));
  }));
  router.delete(`${sets}/:setId/questions/:questionId`, ...admin, guarded(async (req, res) => {
    await deleteQuestion(deps.db, now(), actor(res), slug(req), setId(req), idOf(req.params.questionId));
    res.status(204).end();
  }));
  router.post(`${sets}/:setId/publish`, ...admin, guarded(async (req, res) => {
    parse(publishBody, req.body);
    res.json(await publishSet(deps.db, now(), actor(res), slug(req), setId(req)));
  }));

  // Staff management is for the Super Admin only. It is read-only for now; creating and changing accounts stays on the command line.
  const superAdmin = requireStaff(deps, { roles: ROLES.superAdminOnly });
  router.get("/staff", ...superAdmin, guarded(async (_req, res) => {
    const { rows } = await deps.db.query<{ id: number | string; email: string; display_name: string; role: string; active: number }>("SELECT id, email, display_name, role, active FROM staff_users ORDER BY id");
    res.json({ staff: rows.map((r) => ({ id: Number(r.id), email: r.email, displayName: r.display_name, role: r.role, active: Number(r.active) === 1 })) });
  }));
  return router;
}
