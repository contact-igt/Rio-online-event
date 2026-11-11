import { z } from "zod";
import { writeAudit } from "../auth/audit.ts";
import type { DatabaseAdapter, Queryable } from "../db/adapter.ts";
import { asDate } from "../db/values.ts";
import { AppError } from "../http/errors.ts";

// The one row of event settings an administrator edits. There is no "enabled" switch in the schema: registration is open only while now is
// inside the window AND a consent version is set (the same rule the public API applies). "Disabled" therefore means "no window".
// Rules enforced here (the database repeats the structural ones as CHECK constraints and a trigger):
//   * dates are ISO-8601 with an explicit offset, stored in UTC, shown in Asia/Kolkata;
//   * opening needs a closing time and a consent version; closing is after opening;
//   * results are published after registration closes and only at a future time; an already-published time is never moved;
//   * M5A guard: a change that would leave registration open at the moment of saving is refused, so this milestone cannot open registration.

export const TIME_ZONE = "Asia/Kolkata";

export type SettingsView = { opensAt: Date | null; closesAt: Date | null; resultsPublishAt: Date | null; guardianConsentVersion: string | null; mediaConsentVersion: string | null; updatedAt: Date | null };

export type PublicSettingsView = {
  timezone: typeof TIME_ZONE;
  registrationOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  resultsPublishAt: string | null;
  resultsPublished: boolean;
  guardianConsentVersion: string | null;
  mediaConsentVersion: string | null;
  updatedAt: string | null;
};

type Row = { submissions_open_at: unknown; submissions_close_at: unknown; results_publish_at: unknown; guardian_consent_version: string | null; media_consent_version: string | null; updated_at: unknown };
const date = (v: unknown): Date | null => (v === null || v === undefined ? null : asDate(v));

export async function loadSettings(db: Queryable): Promise<SettingsView> {
  const row = (await db.query<Row>("SELECT submissions_open_at, submissions_close_at, results_publish_at, guardian_consent_version, media_consent_version, updated_at FROM event_settings WHERE id = 1")).rows[0];
  return {
    opensAt: date(row?.submissions_open_at),
    closesAt: date(row?.submissions_close_at),
    resultsPublishAt: date(row?.results_publish_at),
    guardianConsentVersion: row?.guardian_consent_version ?? null,
    mediaConsentVersion: row?.media_consent_version ?? null,
    updatedAt: date(row?.updated_at),
  };
}

export const registrationOpenAt = (s: SettingsView, now: Date): boolean =>
  s.opensAt !== null && s.closesAt !== null && s.guardianConsentVersion !== null && now >= s.opensAt && now < s.closesAt;

export const present = (s: SettingsView, now: Date): PublicSettingsView => ({
  timezone: TIME_ZONE,
  registrationOpen: registrationOpenAt(s, now),
  opensAt: s.opensAt?.toISOString() ?? null,
  closesAt: s.closesAt?.toISOString() ?? null,
  resultsPublishAt: s.resultsPublishAt?.toISOString() ?? null,
  resultsPublished: s.resultsPublishAt !== null && s.resultsPublishAt <= now,
  guardianConsentVersion: s.guardianConsentVersion,
  mediaConsentVersion: s.mediaConsentVersion,
  updatedAt: s.updatedAt?.toISOString() ?? null,
});

const when = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const version = z.string().regex(/^[A-Za-z0-9._-]{1,40}$/, "invalid_consent_version");

/** Fields left out stay as they are; null clears. Unknown fields (for example registrationOpen or a role) are refused, not ignored. */
export const patchBody = z
  .strictObject({
    opensAt: when.nullable(),
    closesAt: when.nullable(),
    resultsPublishAt: when.nullable(),
    guardianConsentVersion: version.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "empty");

export type SettingsPatch = z.infer<typeof patchBody>;
export class SettingsInvalid extends AppError {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super(422, "invalid_settings", "The settings are not valid.");
    this.fields = fields;
  }
}

const sameInstant = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());

/** Pure validation of the settings that would result from a change. Returns field codes; empty means valid. */
export function problems(next: SettingsView, current: SettingsView, now: Date): Record<string, string> {
  const out: Record<string, string> = {};
  if ((next.opensAt === null) !== (next.closesAt === null)) out[next.opensAt === null ? "opensAt" : "closesAt"] = "window_needs_both";
  else if (next.opensAt && next.closesAt && next.closesAt <= next.opensAt) out.closesAt = "close_before_open";
  if (next.opensAt && next.guardianConsentVersion === null) out.guardianConsentVersion = "consent_version_required";
  if (next.resultsPublishAt) {
    if (next.closesAt === null) out.resultsPublishAt = "results_need_close";
    else if (next.resultsPublishAt < next.closesAt) out.resultsPublishAt = "results_before_close";
  }
  if (!out.resultsPublishAt && !sameInstant(next.resultsPublishAt, current.resultsPublishAt) && next.resultsPublishAt && next.resultsPublishAt <= now) out.resultsPublishAt = "results_in_past";
  if (!out.opensAt && !out.closesAt && registrationOpenAt(next, now)) out.opensAt = "registration_not_openable_yet";
  return out;
}

export async function updateSettings(db: DatabaseAdapter, now: Date, actor: { staffId: number; requestId: string }, patch: SettingsPatch): Promise<PublicSettingsView> {
  return db.transaction(async (tx) => {
    const current = await loadSettings(tx);
    const next: SettingsView = {
      ...current,
      ...(patch.opensAt !== undefined && { opensAt: patch.opensAt }),
      ...(patch.closesAt !== undefined && { closesAt: patch.closesAt }),
      ...(patch.resultsPublishAt !== undefined && { resultsPublishAt: patch.resultsPublishAt }),
      ...(patch.guardianConsentVersion !== undefined && { guardianConsentVersion: patch.guardianConsentVersion }),
    };
    const changed: string[] = (["opensAt", "closesAt", "resultsPublishAt"] as const).filter((k) => !sameInstant(current[k], next[k]));
    if (current.guardianConsentVersion !== next.guardianConsentVersion) changed.push("guardianConsentVersion");
    if (changed.length === 0) return present(current, now);

    if (current.resultsPublishAt && current.resultsPublishAt <= now && changed.includes("resultsPublishAt")) {
      throw new AppError(409, "results_already_published", "Results are already published and cannot be rescheduled.");
    }
    const found = problems(next, current, now);
    if (Object.keys(found).length > 0) throw new SettingsInvalid(found);

    const result = await tx.query(
      "UPDATE event_settings SET submissions_open_at = ?, submissions_close_at = ?, results_publish_at = ?, guardian_consent_version = ?, updated_at = ?, updated_by = ? WHERE id = 1",
      [next.opensAt, next.closesAt, next.resultsPublishAt, next.guardianConsentVersion, now, actor.staffId],
    );
    if (result.affectedRows !== 1) throw new AppError(409, "settings_missing", "The event settings row is missing.");
    // Fixed labels, instants and the consent label only: nothing typed as free text, no personal data.
    await writeAudit(tx, now, {
      actorType: "staff",
      actorStaffId: actor.staffId,
      action: "settings.update",
      entityType: "event_settings",
      entityId: 1,
      requestId: actor.requestId,
      details: {
        changed: changed.join(","),
        opensAt: next.opensAt?.toISOString() ?? null,
        closesAt: next.closesAt?.toISOString() ?? null,
        resultsPublishAt: next.resultsPublishAt?.toISOString() ?? null,
        guardianConsentVersion: next.guardianConsentVersion,
      },
    });
    return present({ ...next, updatedAt: now }, now);
  });
}
