import { ViewTransition } from "react";

// Every page fades through to the next: the page being left goes quickly, then the new one comes
// up. The room behind them (its light and the air), the ribbon and the shears are not part of it,
// so they carry straight on. Layouts persist across navigations, so the boundary lives here: the
// template remounts on every route, which makes the old page an exit and the new one an enter.
// `default="none"` keeps refreshes and transitions inside a page (a POS sync) from fading it.
// globals.css draws both sides.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="rz-page-in" exit="rz-page-out" default="none">
      {children}
    </ViewTransition>
  );
}
