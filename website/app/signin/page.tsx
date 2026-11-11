import { redirect } from "next/navigation";

// Parent sign-in was retired with the move to the Express API: no one-time code, no parent account. proxy.ts redirects first; this keeps the route inert if that ever changes.
export default function SignInPage(): never {
  redirect("/competitions");
}
