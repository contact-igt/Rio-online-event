// Browser entry for e2e/one-page-register.spec.ts: the REAL RegistrationForm in its one-page mode (details, video, consent, one Submit),
// with fake server actions for saving, the upload and the submission. Bundled by the spec; never part of the app.

import { createRoot } from "react-dom/client";
import { RegistrationForm } from "@/components/registration/registration-form";
import { getConsentCopy } from "@/lib/registration/consent";

const consent = getConsentCopy("v0-provisional")!;

createRoot(document.getElementById("root")!).render(
  <RegistrationForm event={{ slug: "kutti-pesalar", minAge: 8, maxAge: 12 }} consent={consent} draft={null} finish={{ hasVideo: false, uploadsOpen: true }} />,
);
