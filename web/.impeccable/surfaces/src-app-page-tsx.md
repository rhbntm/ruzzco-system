---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components/RuzzcoBrand.tsx","src/components/ForecastPanel.tsx","src/components/OwnerDrawer.tsx","src/app/globals.css"]
---

# Surface brief: home page (`/`)

Scope: `src/app/page.tsx` and the components it alone uses. Visitor mode: Persuade (demo-ready front door; it must also stay the fastest way in for daily use).
Audience and job: the SPCC capstone panel on first load (what this is, why it is trustworthy); barbers on phones (one tap to the POS); Mart (close out, owner tools, the 7-day forecast).
Content kept (user, 2026-10-15): today's numbers, the price list, how a sale is recorded, the built-so-far list, the forecast, every route link, hours and location.
Owner's drawer (user, 2026-10-15): its own section, the counter's full-width drawer under the tools (chosen over a section lower down). Later the same day (user): it loads shut for everyone and shows nothing of what is inside; clicking it opens it to the four tools (Barber Ledger, Insights, Payment QR, the 7-day forecast), each owner page keeping its own PIN gate and the forecast asking for the owner PIN inside. No figure before the PIN.
Constraints: the app-wide Shop After Dark world stays (user: "new layout, same look"); every function, aria name, live region and 44px touch target preserved; no invented prices, counts or claims; fonts self-hosted; no motion library.

## Direction contract

THESIS: The home page is a barber's station seen from the chair: an LED-ringed mirror reflecting the crimson accent wall and the shop's sign, a black counter where the day's tools lie ready, and under them the owner's books in the counter's own locked drawer. It refuses the category default: a logo card centred over a stack of equal panels.

OWN-WORLD: The incumbent Shop After Dark system. Polished chrome mirror bezel with a frosted LED ring; inside the glass the crimson wall, the logo sign and vinyl-lettered day figures; a full-bleed black counter with a chrome nosing; tool plates in leather-black, the POS plate in crimson enamel; the drawer front in panel lacquer with a routed groove, a brass nameplate, a brass lock plate and a brass bar pull, and behind it a felt-black tray with a raised divider.

STORY: Anyone sees the shop in the mirror and reads the hook; a barber taps Open the POS; Mart closes out, or pulls the drawer out to the ledger, insights, payment QR and the forecast, entering the PIN for the forecast; the panel scrolls to watch one sale go from the phone to the books, then reads what is built.

FIRST VIEWPORT: Desktop: the mirror fills the top two thirds (sign at left about 600px wide, hook "Every cut, counted once." in Oswald about 72px at right, the vinyl day line along the glass foot). Below, the counter row: Open the POS (crimson, widest), Shift Log, End-of-Day Cash; under it the counter's full-width drawer front, shut: nameplate, lock plate and pull centred, its top at the fold. Phone: sign, hook, then the counter with Open the POS full width inside the first screen.

FORM: user-chosen "The Station", dealt card 3 of 3 (position 7 on the ranked list). Seed key eaf8f3fb. Signature interaction: the station switches on as the page arrives (LED ring powers up, the reflection brightens), and the glass's sheen and reflection shift with the pointer like a real mirror. Second moment (user, 2026-10-15): the shut drawer slides out under the counter wherever its front is taken; the owner PIN, entered inside, turns its key a quarter.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
