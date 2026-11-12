"use client";

import { useState } from "react";
import { provisionJudge } from "@/app/admin/judges/actions";
import { CredentialsPanel, HiddenNote } from "@/components/admin/credentials-panel";
import { Icon } from "@/components/ui/icon";
import { staff } from "@/lib/staff/messages";

// The Add judge form. While adding is switched off the form is disabled and says why; success appears only when the server reports that the
// account is complete, and then the generated password is shown once (see CredentialsPanel). Nothing is e-mailed.

const M = staff.judges;
type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; email: string; password: string }
  | { kind: "hidden" }
  | { kind: "failed"; message: string };

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold leading-snug text-rio-navy">
      <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
      <span>{children}</span>
    </p>
  );
}

export function ProvisionJudgeForm({ enabled, secretKey }: { enabled: boolean; secretKey: "ok" | "missing" | "badFormat" }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const ready = enabled && secretKey === "ok";
  const busy = state.kind === "sending";

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setState({ kind: "sending" });
    const result = await provisionJudge({
      email: String(data.get("email") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      emailVerified: data.get("verified") === "on",
    }).catch(() => null);
    if (!result) return setState({ kind: "failed", message: M.errors.unavailable });
    if (!result.ok) return setState({ kind: "failed", message: M.provErrors[result.code] });
    form.reset();
    setState({ kind: "done", email: result.email, password: result.password });
  }

  return (
    <div className="space-y-4">
      <p className="max-w-4xl text-xs leading-relaxed text-rio-slate sm:text-sm">{M.addIntro}</p>
      {!enabled && <Warning>{M.off}</Warning>}
      {enabled && secretKey !== "ok" && <Warning>{M.noKey}</Warning>}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void submit(e.currentTarget);
        }}
        className="grid gap-x-4 gap-y-3 sm:grid-cols-2"
      >
        <div>
          <label htmlFor="judge-name" className="block text-xs font-semibold leading-snug text-rio-navy">
            {M.name.en} <span lang="ta" className="font-medium text-rio-slate">/ {M.name.ta}</span>
          </label>
          <input id="judge-name" name="displayName" type="text" autoComplete="off" maxLength={80} required disabled={!ready} className="field mt-1 h-11 min-h-11 text-sm" />
        </div>
        <div>
          <label htmlFor="judge-email" className="block text-xs font-semibold leading-snug text-rio-navy">
            {M.email.en} <span lang="ta" className="font-medium text-rio-slate">/ {M.email.ta}</span>
          </label>
          <input id="judge-email" name="email" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={!ready} className="field mt-1 h-11 min-h-11 text-sm" />
        </div>
        <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-11 min-w-0 items-center gap-3 text-xs font-semibold leading-snug text-rio-navy">
            <input type="checkbox" name="verified" disabled={!ready} className="h-5 w-5 shrink-0 accent-rio-rose" />
            <span>{M.verified}</span>
          </label>
          <button type="submit" disabled={!ready || busy} aria-busy={busy} className="btn btn-primary h-11 min-h-11 w-full !px-5 text-sm sm:w-auto sm:shrink-0">
            <span>{(busy ? M.adding : M.addButton).en}</span>
            <span lang="ta" className="font-medium">{(busy ? M.adding : M.addButton).ta}</span>
          </button>
        </div>
      </form>
      {state.kind === "failed" && (
        <p role="alert" className="font-semibold text-rio-error">
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <div className="space-y-3">
          <p role="status" className="font-semibold text-rio-ok">
            {M.added.en}: <span className="break-all">{state.email}</span>
          </p>
          <CredentialsPanel email={state.email} password={state.password} onDone={() => setState({ kind: "hidden" })} />
        </div>
      )}
      {state.kind === "hidden" && <HiddenNote />}
    </div>
  );
}
