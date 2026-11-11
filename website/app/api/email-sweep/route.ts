// The old retry worker for confirmation e-mails read a Supabase outbox. Sending moves to the Express API's outbox in a later module, so until
// then this endpoint stays closed: a plain 404 for everyone, whatever the credentials, and it reads no service.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
