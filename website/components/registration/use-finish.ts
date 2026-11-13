"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveDraft, type SaveState } from "@/app/events/[slug]/register/actions";
import { submitEntry } from "@/app/events/[slug]/register/submit-actions";
import { confirmVideoUpload, requestVideoUpload } from "@/app/events/[slug]/register/video-actions";
import { reg, type Msg } from "@/lib/registration/messages";
import type { SubmitErrorCode } from "@/lib/submit/api-codes";
import { readVideoDuration } from "@/lib/upload/duration";
import { PutError, putFile } from "@/lib/upload/put";
import { checkFile, checkVideo, videoTypeOf, type UploadErrorCode, type VideoProblem } from "@/lib/upload/rules";

// One page, one button (owner, 2026-11-13: "enter the details, upload the video, tick the checkbox, submit"). Submit runs three server
// steps in order: save the details (the API sets the registration cookie), upload the chosen video straight to the bucket, then submit the
// entry. The API stays the authority at every step; this only sequences them and keeps what is done, so a retry after a failure never
// creates a second entry (it updates the saved one) and never uploads a second video.

export type Picked = { file: File; type: string; seconds: number };
export type Phase = { kind: "idle" } | { kind: "checking" } | { kind: "saving" } | { kind: "uploading"; pct: number } | { kind: "verifying" } | { kind: "submitting" } | { kind: "done" };

const UPLOAD = reg.upload.errors;
const SUBMIT = reg.submit.errors;
const uploadMessage = (code: UploadErrorCode): Msg => (code in reg.upload.problems ? reg.upload.problems[code as VideoProblem] : (UPLOAD[code as keyof typeof UPLOAD] ?? UPLOAD.unavailable));
const submitMessage = (code: SubmitErrorCode): Msg => SUBMIT[code as keyof typeof SUBMIT] ?? SUBMIT.unavailable;
// The API removes a video it refuses at submission, so the parent must choose one again.
const VIDEO_GONE: readonly SubmitErrorCode[] = ["noVideo", "videoInvalid", "videoDuration"];

export function useFinish(hasVideo: boolean, alreadySaved: boolean) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [uploaded, setUploaded] = useState(hasVideo);
  const [form, setForm] = useState<SaveState>(undefined);
  const [videoError, setVideoError] = useState<Msg | null>(null);
  const [error, setError] = useState<Msg | null>(null);
  const saved = useRef(alreadySaved);
  const done = useRef(hasVideo);
  const inflight = useRef(false);
  const busy = phase.kind !== "idle" && phase.kind !== "done";

  // Leaving mid-upload loses the upload: ask the browser to warn first.
  useEffect(() => {
    if (!busy || phase.kind === "checking") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, phase.kind]);

  async function pick(file: File | undefined) {
    if (!file || inflight.current) return;
    setVideoError(null);
    setPicked(null);
    setPhase({ kind: "checking" });
    const type = videoTypeOf(file);
    const basic = checkFile({ type, bytes: file.size }); // cheap checks first: never decode a file that is already refused
    if (basic) {
      setPhase({ kind: "idle" });
      return setVideoError(reg.upload.problems[basic]);
    }
    const seconds = await readVideoDuration(file);
    const problem = checkVideo({ type, bytes: file.size, seconds });
    setPhase({ kind: "idle" });
    if (problem) return setVideoError(reg.upload.problems[problem]);
    setPicked({ file, type, seconds: Math.round(seconds ?? 0) });
  }

  function stop(update: () => void) {
    inflight.current = false;
    setPhase({ kind: "idle" });
    update();
  }

  async function run(data: FormData) {
    if (inflight.current) return;
    setError(null);
    setVideoError(null);
    if (!done.current && !picked) return setVideoError(reg.finish.videoNeeded);
    inflight.current = true;

    // 1. The details. After the first save the entry exists: later attempts update it instead of creating another.
    setPhase({ kind: "saving" });
    if (saved.current) data.set("draftId", "current");
    const result = await saveDraft(undefined, data).catch(() => null);
    if (!result) return stop(() => setError(UPLOAD.network));
    if (!result.saved) return stop(() => setForm(result));
    saved.current = true;
    setForm(undefined);

    // 2. The video, once.
    if (!done.current && picked) {
      setPhase({ kind: "uploading", pct: 0 });
      const started = await requestVideoUpload({ type: picked.type, bytes: picked.file.size }).catch(() => null);
      if (!started) return stop(() => setVideoError(UPLOAD.network));
      if (!started.ok) return stop(() => setVideoError(uploadMessage(started.code)));
      try {
        await putFile(started.url, picked.file, started.contentType, (pct) => setPhase({ kind: "uploading", pct }));
      } catch (e) {
        return stop(() => setVideoError(e instanceof PutError && e.message === "status" ? UPLOAD.missing : UPLOAD.network));
      }
      setPhase({ kind: "verifying" });
      const finished = await confirmVideoUpload({ uploadId: started.uploadId }).catch(() => null);
      if (!finished) return stop(() => setVideoError(UPLOAD.network));
      if (!finished.ok) return stop(() => setVideoError(uploadMessage(finished.code)));
      done.current = true;
      setUploaded(true);
      setPicked(null);
    }

    // 3. The submission.
    setPhase({ kind: "submitting" });
    const submitted = await submitEntry().catch(() => null);
    if (!submitted) return stop(() => setError(SUBMIT.network));
    if (!submitted.ok) {
      const code = submitted.code;
      return stop(() => {
        if (VIDEO_GONE.includes(code)) {
          done.current = false;
          setUploaded(false);
          setVideoError(submitMessage(code));
        } else setError(submitMessage(code));
      });
    }
    inflight.current = false;
    setPhase({ kind: "done" });
    router.refresh(); // the page now shows the submitted entry
  }

  return { phase, busy, picked, uploaded, form, videoError, error, pick, run };
}
