/** Fixed height and sticky, so the disclaimer is always on screen and layouts can size themselves below it. */
export function DemoBadge() {
  return (
    <div className="sticky top-0 z-20 flex h-8 items-center justify-center border-b bg-card px-4 text-caption text-muted-foreground">
      Concept demo - not tax advice
    </div>
  );
}
