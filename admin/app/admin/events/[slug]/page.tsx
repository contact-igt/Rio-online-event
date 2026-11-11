import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { loadSetList } from "@/lib/admin/questions-api";
import { requireStaff } from "@/lib/staff/auth";

export const metadata = { title: "Competition · Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

// A competition: its name and the state of its question versions, with the way to manage them. Judge assignment, ranking and winners
// are separate modules that have no endpoints yet; nothing is shown for them.
export default async function AdminEventPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireStaff("admin");
  const { slug } = await params;
  const list = await loadSetList(slug);
  if (!list.ok && list.reason === "missing") notFound();

  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-sm text-rio-slate">
        <Link href="/admin#competitions" className="underline underline-offset-2">Competitions</Link> / {list.ok ? list.data.competition.nameEn : slug}
      </nav>
      <h1 className="mt-2 text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold">
        {list.ok ? list.data.competition.nameTa : "போட்டி"}
        <span lang="en" className="block text-[0.6em] font-bold text-rio-slate">{list.ok ? list.data.competition.nameEn : "Competition"}</span>
      </h1>
      <div className="card mt-6 max-w-3xl p-4 sm:p-6">
        <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-rio-navy">
          <Icon name="clipboard" className="h-7 w-7 text-rio-rose" />
          <span className="min-w-0">Registration questions <span lang="ta" className="font-medium">/ பதிவு கேள்விகள்</span></span>
        </h2>
        {list.ok ? (
          <dl className="mt-3 divide-y divide-rio-navy/10">
            {[
              ["Published version", list.data.sets.find((s) => s.status === "published") ? `v${list.data.sets.find((s) => s.status === "published")!.version} (${list.data.sets.find((s) => s.status === "published")!.questionCount} questions)` : "None yet"],
              ["Draft", list.data.sets.find((s) => s.status === "draft") ? `v${list.data.sets.find((s) => s.status === "draft")!.version} (${list.data.sets.find((s) => s.status === "draft")!.questionCount} questions)` : "None"],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-x-4 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <dt className="text-rio-slate">{k}</dt>
                <dd className="font-semibold text-rio-navy">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p role="alert" className="mt-3 font-semibold text-rio-error">The question versions could not be loaded. Reload to try again. <span lang="ta" className="block font-medium">ஏற்ற முடியவில்லை.</span></p>
        )}
        <Link href={`/admin/events/${slug}/questions`} className="btn btn-primary mt-4 w-full sm:w-auto">
          <span>கேள்விகளை நிர்வகி</span>
          <span lang="en" className="font-medium">Manage questions</span>
        </Link>
      </div>
      <Link href="/admin#competitions" className="btn btn-outline mt-6 w-full sm:w-auto">Back / திரும்பு</Link>
    </section>
  );
}
