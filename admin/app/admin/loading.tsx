export default function AdminLoading() {
  return (
    <section className="mx-auto w-full max-w-[1200px] px-4 py-[clamp(1.5rem,5vw,3rem)] sm:px-6 lg:px-8" aria-busy="true" aria-live="polite">
      <div className="card animate-pulse p-6">
        <div className="h-9 w-52 rounded bg-rio-mist" />
        <div className="mt-6 h-28 rounded-2xl bg-rio-mist" />
        <div className="mt-4 h-28 rounded-2xl bg-rio-mist" />
        <p className="sr-only">Loading administration page</p>
      </div>
    </section>
  );
}
