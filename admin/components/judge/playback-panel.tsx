"use client";

import { useRef, useState } from "react";
import { getPlaybackUrl } from "@/app/judge/actions";
import { Bilingual, FieldError } from "@/components/auth/bilingual";
import { Icon } from "@/components/ui/icon";
import type { Msg } from "@/lib/auth/messages";
import { staff } from "@/lib/staff/messages";

// Plays one assigned entry's private video. The page never contains a video address: pressing Play asks the server, which checks this judge's
// assignment and signs a link that lives five minutes. A second press while a request runs is ignored. The frame keeps its 16:9 size in every
// state, so nothing jumps when the video appears.

type State = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; url: string } | { kind: "failed"; message: Msg };
const E = staff.judge.playbackErrors;

/** `available`: the entry has a checked video AND playback is switched on. `reason` says which one is missing when it is false. */
export function PlaybackPanel({ entryId, available, reason = "off" }: { entryId: string; available: boolean; reason?: "off" | "noVideo" }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const inflight = useRef(false);

  if (!available) {
    return (
      <p className="rounded-xl border-l-4 border-rio-pink bg-rio-blush p-3 text-sm font-semibold text-rio-navy">
        <Bilingual m={reason === "noVideo" ? staff.judge.noVideo : staff.judge.playbackOff} />
      </p>
    );
  }

  async function load() {
    if (inflight.current) return;
    inflight.current = true;
    setState({ kind: "loading" });
    const result = await getPlaybackUrl({ entryId }).catch(() => null);
    inflight.current = false;
    if (!result) return setState({ kind: "failed", message: E.network });
    if (!result.ok) return setState({ kind: "failed", message: E[result.code] ?? E.unavailable });
    setState({ kind: "ready", url: result.url });
  }

  const loading = state.kind === "loading";
  const again = state.kind === "ready" || state.kind === "failed";
  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-rio-ink">
        {state.kind === "ready" ? (
          <video
            key={state.url}
            src={state.url}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            onError={() => setState({ kind: "failed", message: staff.judge.playerError })}
            className="absolute inset-0 h-full w-full"
            aria-label="Entry video"
          />
        ) : (
          <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 text-white ${loading ? "animate-pulse" : ""}`}>
            <Icon name="video" className="h-10 w-10 opacity-70" />
            <span className="text-center text-sm font-semibold">{(loading ? staff.judge.loadingVideo : staff.judge.video).ta}<span lang="en" className="block text-xs font-medium text-white/80">{(loading ? staff.judge.loadingVideo : staff.judge.video).en}</span></span>
          </div>
        )}
      </div>
      {state.kind === "failed" && <FieldError id="playback-error" m={state.message} />}
      <button type="button" onClick={() => void load()} disabled={loading} aria-busy={loading} className="btn btn-primary min-h-11 w-full !px-4 text-sm sm:w-auto">
        <span>{(again ? staff.judge.reloadVideo : staff.judge.loadVideo).ta}</span>
        <span lang="en" className="font-medium">{(again ? staff.judge.reloadVideo : staff.judge.loadVideo).en}</span>
      </button>
      <p className="text-xs text-rio-slate">
        <Bilingual m={staff.judge.videoNote} />
      </p>
    </div>
  );
}
