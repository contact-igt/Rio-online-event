import { redirect } from "next/navigation";

// Retired with the parent sign-in (see ../page.tsx).
export default function VerifyPage(): never {
  redirect("/competitions");
}
