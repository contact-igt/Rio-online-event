import { AdminNav } from "@/components/admin/admin-nav";
import { StaffBar } from "@/components/staff/staff-bar";
import { staffSession } from "@/lib/staff/auth";

// The sidebar and bar appear only for a verified administrator, so a parent or judge who lands on a 404 under /admin is shown nothing that
// reveals the area. This is only what is displayed: every admin page and every admin action checks the role again on the server.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const verified = (await staffSession("admin")) !== null;
  return (
    <div className="wash min-h-dvh">
      {verified ? (
        <div className="grid min-h-dvh w-full lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="bg-rio-navy text-white lg:sticky lg:top-0 lg:h-dvh lg:self-start lg:overflow-y-auto">
            <AdminNav />
          </aside>
          <div className="flex min-h-dvh min-w-0 flex-col">
            <StaffBar role="admin" verified />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
