/** Placeholder shown until persisted state has hydrated, sized to match the
 *  real layout so nothing shifts when data arrives. */
export function AppSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[880px] px-4 pt-5 pb-16"
      aria-hidden="true"
    >
      <div className="bg-mist-soft mb-4 h-12 rounded-[11px]" />
      <div className="rounded-card border-hairline bg-card mb-3.5 h-[120px] border" />
      <div className="bg-mist-soft mb-3.5 h-10 rounded-[11px]" />
      <div className="rounded-card border-hairline bg-card h-[420px] border" />
    </div>
  );
}
