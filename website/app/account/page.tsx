import { redirect } from "next/navigation";

// Retired with the parent sign-in (see ../signin/page.tsx): there is no parent account.
export default function AccountPage(): never {
  redirect("/competitions");
}
