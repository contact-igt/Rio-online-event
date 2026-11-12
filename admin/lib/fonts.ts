import { Montserrat, Mulish, Noto_Sans_Tamil } from "next/font/google";

// Self-hosted by next/font at build time. Montserrat matches the hospital website's English UI; Mulish keeps headings calm and clinical;
// Noto Sans Tamil gives Tamil the same clean, readable institutional tone.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-mulish",
  display: "swap",
});

const tamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-noto-tamil",
  display: "swap",
});

export const fontVariables = `${montserrat.variable} ${mulish.variable} ${tamil.variable}`;
