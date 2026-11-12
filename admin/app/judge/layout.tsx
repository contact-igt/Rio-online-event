import { JudgeHeader } from "@/components/judge/judge-header";

export default function JudgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wash min-h-dvh">
      <JudgeHeader />
      {children}
    </div>
  );
}
