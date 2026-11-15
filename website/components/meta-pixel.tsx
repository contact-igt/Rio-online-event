"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

// Meta Pixel, on PUBLIC pages only (owner, 2026-11-15; an exception to the "no ad pixels" rule in CLAUDE.md). Never on the pages where a
// parent types a child's details or signs in. Two switches keep it quiet if a parent clicks from a public page into registration (the
// script then stays loaded): disablePushState stops the automatic PageView on in-site navigation, and autoConfig off stops automatic
// button-click and page-metadata collection. Keep "Automatic advanced matching" OFF in Meta Events Manager: it would read form fields.
const PIXEL_ID = "2209604346605021";

/** Pages where the pixel must not load: registration, sign-in, the parent account and the dev previews. */
export const isPrivatePath = (path: string): boolean => /^\/(events\/[^/]+\/register|signin|account|dev)(\/|$)/.test(path);

export function MetaPixel() {
  const path = usePathname() ?? "/";
  if (isPrivatePath(path)) return null;
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq.disablePushState=true;fbq('set','autoConfig',false,'${PIXEL_ID}');fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img height="1" width="1" style={{ display: "none" }} src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`} alt="" />
      </noscript>
    </>
  );
}
