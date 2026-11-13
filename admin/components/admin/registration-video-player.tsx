"use client";

import { useRef, useState } from "react";
import { getRegistrationVideoUrl } from "@/app/admin/registrations/actions";

// Plays one entry's private video on the registration page. The page holds no video address: Play asks the server, which checks the role,
// writes an audit row and signs a link that lives five minutes. A second press while a request runs is ignored.

type State = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; url: string } | { kind: "failed"; message: string };
const errors: Record<string, string> = {
  sessionExpired: "Your session has expired. Sign in again.",
  notAllowed: "You are not allowed to watch this video.",
  notFound: "This entry has no checked video.",
  storage: "Video playback is not available right now (video storage is not reachable).",
  unavailable: "The video could not be loaded right now. Try again.",
  playerError: "The browser could not play the video. The link lasts five minutes: press Reload video to get a new one.",
};

export function RegistrationVideoPlayer({ entryCode }: { entryCode: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const inflight = useRef(false);

  async function load() {
    if (inflight.current) return;
    inflight.current = true;
    setState({ kind: "loading" });
    const result = await getRegistrationVideoUrl(entryCode).catch(() => null);
    inflight.current = false;
    if (!result) return setState({ kind: "failed", message: errors.unavailable! });
    if (!result.ok) return setState({ kind: "failed", message: errors[result.code] ?? errors.unavailable! });
    setState({ kind: "ready", url: result.url });
  }

  return (
    <div className="mt-3 space-y-3 font-normal">
      {state.kind === "ready" && (
        <video
          key={state.url}
          src={state.url}
          controls
          playsInline
          preload="metadata"
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          onError={() => setState({ kind: "failed", message: errors.playerError! })}
          className="aspect-video w-full max-w-xl rounded-xl bg-rio-ink"
          aria-label={`Video of entry ${entryCode}`}
        />
      )}
      {state.kind === "failed" && <p role="alert" className="text-sm font-semibold text-rio-error">{state.message}</p>}
      <button type="button" onClick={() => void load()} disabled={state.kind === "loading"} aria-busy={state.kind === "loading"} className="btn btn-primary min-h-11 !px-4 text-sm">
        {state.kind === "loading" ? "Loading…" : state.kind === "ready" || state.kind === "failed" ? "Reload video" : "Play video"} <span lang="ta" className="font-medium">/ {state.kind === "ready" || state.kind === "failed" ? "மீண்டும் ஏற்று" : "வீடியோவைப் பார்"}</span>
      </button>
      <p className="text-xs text-rio-slate">The video is private. Each time it is opened it is recorded in the audit log, and the link works for five minutes.</p>
    </div>
  );
}
