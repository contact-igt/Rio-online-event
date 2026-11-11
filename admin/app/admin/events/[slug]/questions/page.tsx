import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { QUESTIONS_PATH } from "@/lib/question-builder/types";

// Questions are shared by every competition and edited in one place, so the old per-competition address goes there.
export default async function CompetitionQuestionsPage() {
  await requireStaff("admin");
  redirect(QUESTIONS_PATH);
}
