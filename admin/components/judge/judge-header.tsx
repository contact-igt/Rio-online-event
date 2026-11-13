import { staffSignOut } from "@/app/staff/login/actions";
import { Icon } from "@/components/ui/icon";
import { currentStaff } from "@/lib/staff/auth";
import { staff } from "@/lib/staff/messages";

// The Judge Portal's top bar: logo and area name on the left, the signed-in judge and Sign out on the right. The name comes from the verified session;
// the bar renders only for a judge, so anyone else who lands on /judge sees nothing that reveals the area.
export async function JudgeHeader() {
  const session = await currentStaff();
  if (!session || session.role !== "judge") return null;
  const name = session.user.displayName;
  return (
    <header className="border-b border-rio-navy/10 bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex min-h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {/* The same supplied logo file as the Admin panel and the public website. */}
          <img src="/images/rio logo v2.png" alt="RIO Hospital" className="h-10 w-auto shrink-0 object-contain" />
          <p className="min-w-0 leading-tight">
            <span className="block text-sm font-bold text-rio-navy sm:text-base">{staff.judge.portal.en}</span>
            <span lang="ta" className="block text-xs font-medium text-rio-slate sm:text-sm">{staff.judge.portal.ta}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-rio-navy" title={name}>
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rio-blush text-rio-rose"><Icon name="user" className="h-5 w-5" /></span>
            <span className="hidden max-w-[12rem] truncate sm:block">{name}</span>
            <span className="sr-only sm:hidden">{name}</span>
          </p>
          <form action={staffSignOut}>
            <button type="submit" className="btn btn-outline min-h-10 !px-3 !py-1 text-xs sm:text-sm">
              {staff.login.signOut.en} <span lang="ta" className="hidden font-medium sm:inline">/ {staff.login.signOut.ta}</span>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
