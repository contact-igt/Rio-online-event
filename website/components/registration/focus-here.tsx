"use client";

import { useEffect } from "react";

// The success panel replaces the form after Submit, while the window is still scrolled down to where the Submit button was. Moving focus to
// the panel's heading brings it into view and tells a screen reader what happened.
export function FocusHere({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [id]);
  return null;
}
