// Single source of truth for the competitions shown on the public site. Tamil names, ages and tasks come from the
// event poster. English names are plain-language glosses and English task lines are translations of the poster's Tamil; both are
// marked for owner confirmation in PROJECT_BRIEF.md. The poster's competitions 5 (Tamil Art Studio, tamil-kalaikoodam) and 6 (Say It
// in Tamil, tamilil-sollu) were withdrawn by the owner on 2026-11-11 and are not shown; their rows stay in the database.

export const AGE_MIN = 3;
export const AGE_MAX = 12;
export const AGES: readonly number[] = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i);

export type CompetitionEvent = {
  number: number;
  slug: string;
  nameTa: string;
  nameEn: string;
  minAge: number;
  maxAge: number;
  taskTa: string;
  taskEn: string;
};

export const events: readonly CompetitionEvent[] = [
  {
    number: 1,
    slug: "malalai-mozhi",
    nameTa: "மழலை மொழி",
    nameEn: "Toddler Tamil",
    minAge: 3,
    maxAge: 5,
    taskTa: "தமிழ் மழலைப் பாடல் அல்லது பிடித்த தமிழ் வார்த்தைகளை சொல்லுங்கள்!",
    taskEn: "Sing a Tamil rhyme or say your favourite Tamil words.",
  },
  {
    number: 2,
    slug: "kathai-sollum-kutties",
    nameTa: "கதை சொல்லும் குட்டீஸ்",
    nameEn: "Little Storytellers",
    minAge: 5,
    maxAge: 8,
    taskTa: "தமிழில் ஒரு சிறிய கதை சொல்லுங்கள்!",
    taskEn: "Tell a short story in Tamil.",
  },
  {
    number: 3,
    slug: "thirukkural-thiramai",
    nameTa: "திருக்குறள் திறமை",
    nameEn: "Thirukkural Talent",
    minAge: 6,
    maxAge: 12,
    taskTa: "ஒரு திருக்குறளைச் சொல்லி அதன் பொருளை விளக்குங்கள்!",
    taskEn: "Recite one Thirukkural and explain its meaning.",
  },
  {
    number: 4,
    slug: "kutti-pesalar",
    nameTa: "குட்டிப் பேச்சாளர்",
    nameEn: "Little Speaker",
    minAge: 8,
    maxAge: 12,
    taskTa: "தலைப்பு: “தமிழ் என் அடையாளம்” – 1 நிமிட உரை!",
    taskEn: "Give a 1-minute speech. Topic: “Tamil is my identity”.",
  },
];

export const rules = {
  videoSeconds: { min: 30, max: 90 },
};

export const prizes = [
  { place: "1st Prize", placeTa: "முதல் பரிசு", amount: 5000, formatted: "₹5,000", medal: "🥇" },
  { place: "2nd Prize", placeTa: "இரண்டாம் பரிசு", amount: 3000, formatted: "₹3,000", medal: "🥈" },
  { place: "3rd Prize", placeTa: "மூன்றாம் பரிசு", amount: 2000, formatted: "₹2,000", medal: "🥉" },
] as const;

// Award categories in Tamil, as given by the owner on 2026-11-12 (they replace the poster's six English names). Which competition each
// belongs to is not stated.
export const awards: readonly string[] = [
  "மழலை மொழி மன்னன் / மங்கை",
  "குட்டிக் கதைச் செல்வன் / செல்வி",
  "கற்பனைச் சிறகு விருது",
  "தமிழ்த் தாரகை விருது",
  "குட்டிக் கலைச்சுடர் விருது",
];

// The winners announcement date is pending client approval, so no date is hardcoded anywhere. Set it here (both languages) once the
// client approves it; every page and the confirmation e-mail then show it. Until then they say the date will be confirmed later.
export const announcement: { textEn: string; textTa: string } | null = null;

export function winnersLine(): { ta: string; en: string } {
  return announcement
    ? { ta: `வெற்றியாளர்கள் ${announcement.textTa} அன்று அறிவிக்கப்படுவார்கள்.`, en: `Winners will be announced on ${announcement.textEn}.` }
    : { ta: "வெற்றியாளர்கள் அறிவிப்புத் தேதி பின்னர் உறுதிசெய்யப்படும்.", en: "The winners announcement date will be confirmed later." };
}

export function getEvent(slug: string): CompetitionEvent | undefined {
  return events.find((e) => e.slug === slug);
}

export function fitsAge(event: CompetitionEvent, age: number): boolean {
  return age >= event.minAge && age <= event.maxAge;
}

export function sharedAges(a: CompetitionEvent, b: CompetitionEvent): { min: number; max: number } | null {
  const min = Math.max(a.minAge, b.minAge);
  const max = Math.min(a.maxAge, b.maxAge);
  return min <= max ? { min, max } : null;
}

export function ageRangeEn(min: number, max: number): string {
  return min === max ? `age ${min}` : `ages ${min}–${max}`;
}
