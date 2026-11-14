/**
 * Tests the /pos sheets and the phone's Back (src/lib/sheet-stack.ts, slice 17b). No server needed.
 *
 *   npm run test:sheet-stack
 *
 * A pretend browser history and a pretend /pos drive the two rules the page uses
 * (src/lib/use-sheet-back.ts applies them to the real history): one history entry per open sheet,
 * and Back closes the sheet on top. A step back asked for by the page lands later, like the real
 * history.go(), so the checks cover what happens in between.
 */
import { IDLE, openSheets, sheetPop, syncSheets, type SheetFlags, type SheetId, type SheetMove, type SheetNav } from "../src/lib/sheet-stack";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CLOSED: SheetFlags = { settings: false, charging: false, digital: false, done: false };

/**
 * /pos on top of a pretend history. Entries are depth marks: "home" is the page before the POS,
 * 0 is the POS itself, 1 and up are sheet entries.
 */
function fakePos() {
  const entries: (number | "home")[] = ["home", 0];
  let at = 1;
  let nav: SheetNav = IDLE;
  let flags: SheetFlags = { ...CLOSED };
  // Steps asked for with history.go() that have not landed yet.
  const pendingGo: number[] = [];
  let sales = 0;
  let routerSaw = 0;

  const sheets = () => openSheets(flags);
  const mark = () => {
    const entry = entries[at];
    return entry === "home" ? 0 : entry;
  };
  const closeTop = (count: number) => {
    for (const id of sheets().slice(-count)) {
      if (id === "settings") flags.settings = false;
      else if (id === "charge") flags.charging = false;
      else if (id === "digital") flags.digital = false;
      else flags.done = false;
    }
  };
  const apply = (move: SheetMove) => {
    nav = move.nav;
    for (const pushed of move.push) {
      entries.splice(at + 1);
      entries.push(pushed);
      at = entries.length - 1;
    }
    if (move.go !== 0) pendingGo.push(move.go);
    if (move.close > 0) closeTop(move.close);
  };
  // The page re-rendered with other sheets open: the hook's sync effect.
  const sync = () => apply(syncSheets(nav, sheets().length, mark()));
  // The browser moved: the hook's popstate listener.
  const land = (to: number) => {
    at = Math.max(0, Math.min(entries.length - 1, to));
    if (entries[at] === "home") return;
    const move = sheetPop(nav, sheets().length, mark());
    if (!move.handled) routerSaw++;
    apply(move);
  };
  const set = (change: Partial<SheetFlags>) => {
    flags = { ...flags, ...change };
    sync();
  };

  return {
    get sheets(): SheetId[] { return sheets(); },
    get top(): SheetId | undefined { return sheets().at(-1); },
    get onPos() { return entries[at] !== "home"; },
    get entry() { return entries[at]; },
    get sales() { return sales; },
    get routerSaw() { return routerSaw; },
    get stepping() { return pendingGo.length > 0; },
    // What the barber does on screen.
    charge: () => set({ charging: true }),
    settings: () => set({ settings: true }),
    closeSettings: () => set({ settings: false }),
    chargeBack: () => set({ charging: false }),
    gcash: () => set({ digital: true }),
    digitalBack: () => set({ digital: false }),
    recordCash: () => { sales++; set({ charging: false, done: true }); },
    recordDigital: () => { sales++; set({ digital: false, charging: false, done: true }); },
    // The done screen appears a render before the charge sheet goes (two state updates).
    recordCashInTwoRenders: () => { sales++; set({ done: true }); set({ charging: false }); },
    newSale: () => set({ done: false }),
    // The browser.
    back: () => land(at - 1),
    forward: () => land(at + 1),
    /** Lets the page's own steps back land, oldest first. */
    settle: () => { while (pendingGo.length > 0) land(at + pendingGo.shift()!); },
  };
}

console.log("Sheets, bottom to top");
check("none open", openSheets(CLOSED).length === 0);
check("the charge sheet alone", openSheets({ ...CLOSED, charging: true }).join() === "charge");
check("the GCash/Maya dialog sits on the charge sheet", openSheets({ ...CLOSED, charging: true, digital: true }).join() === "charge,digital");
check("the done screen is on top of anything still open", openSheets({ settings: true, charging: true, digital: true, done: true }).at(-1) === "done");

console.log("\nBack with a sheet open");
{
  const pos = fakePos();
  pos.charge();
  check("Charge gives the sheet its own history entry", pos.entry === 1 && pos.top === "charge");
  pos.back();
  check("Back closes the charge sheet and stays on the POS", pos.sheets.length === 0 && pos.onPos && pos.entry === 0);
  check("nothing was recorded", pos.sales === 0);
  check("the router never saw that step", pos.routerSaw === 0);
  pos.back();
  check("Back with nothing open leaves the POS, as before", !pos.onPos);
}
{
  const pos = fakePos();
  pos.settings();
  pos.back();
  check("Back closes the settings sheet", pos.sheets.length === 0 && pos.onPos);
}

console.log("\nGCash/Maya dialog: every way out goes to the charge sheet");
{
  const pos = fakePos();
  pos.charge();
  pos.gcash();
  check("the dialog has its own entry above the charge sheet's", pos.entry === 2 && pos.sheets.join() === "charge,digital");
  pos.back();
  check("the phone's Back returns to the charge sheet", pos.sheets.join() === "charge" && pos.entry === 1);
  pos.gcash();
  pos.digitalBack();
  check("the dialog's Back returns to the charge sheet", pos.sheets.join() === "charge");
  pos.settle();
  check("and closes nothing more when the browser steps back", pos.sheets.join() === "charge" && pos.entry === 1 && pos.sales === 0);
  pos.back();
  check("one more Back is the ticket", pos.sheets.length === 0 && pos.onPos && pos.entry === 0);
}

console.log("\nA sheet closed on screen");
{
  const pos = fakePos();
  pos.charge();
  pos.chargeBack();
  check("the sheet closes at once", pos.sheets.length === 0);
  pos.settle();
  check("its history entry is given back", pos.entry === 0 && pos.onPos);
  check("the router never saw that step", pos.routerSaw === 0);
  pos.back();
  check("so the next Back leaves the POS (no dead press)", !pos.onPos);
}

console.log("\nCharge, Record, done screen");
{
  const pos = fakePos();
  pos.charge();
  pos.recordCash();
  check("the done screen takes the charge sheet's place: no new entry", pos.top === "done" && pos.entry === 1 && !pos.stepping);
  pos.back();
  check("Back on the done screen is New sale: a clear ticket, still on the POS", pos.sheets.length === 0 && pos.onPos);
  check("one sale, not undone by Back", pos.sales === 1);
}
{
  const pos = fakePos();
  pos.charge();
  pos.recordCashInTwoRenders();
  pos.settle();
  check("done screen a render before the charge sheet goes: still one sheet, one entry", pos.sheets.join() === "done" && pos.entry === 1);
  pos.newSale();
  pos.settle();
  check("New sale gives the entry back", pos.sheets.length === 0 && pos.entry === 0);
}
{
  const pos = fakePos();
  pos.charge();
  pos.gcash();
  pos.recordDigital();
  check("GCash recorded: only the done screen is open", pos.sheets.join() === "done" && pos.sales === 1);
  pos.settle();
  check("the dialog's entry is given back, the done screen keeps one", pos.entry === 1 && pos.sheets.join() === "done");
  pos.back();
  check("Back is New sale", pos.sheets.length === 0 && pos.onPos && pos.entry === 0);
}

console.log("\nWhile the browser is still stepping back");
{
  const pos = fakePos();
  pos.charge();
  pos.chargeBack();
  // Before the step back lands, the barber taps Charge again.
  pos.charge();
  check("a sheet opened meanwhile is open", pos.sheets.join() === "charge");
  pos.settle();
  check("it is kept when the step lands, with an entry of its own", pos.sheets.join() === "charge" && pos.entry === 1);
  pos.back();
  check("and Back closes it", pos.sheets.length === 0 && pos.onPos);
}
{
  const pos = fakePos();
  pos.charge();
  pos.gcash();
  pos.digitalBack();
  pos.chargeBack();
  check("two sheets closed one after the other, before the first step lands", pos.sheets.length === 0);
  pos.settle();
  check("both entries are given back", pos.entry === 0 && pos.onPos);
}
{
  const pos = fakePos();
  pos.charge();
  pos.chargeBack();
  // The barber presses the phone's Back before the page's own step back has landed.
  pos.back();
  pos.settle();
  check("Back pressed right after closing a sheet: nothing reopens, nothing is recorded", pos.sheets.length === 0 && pos.sales === 0);
}

console.log("\nForward into a closed sheet's entry (desktop browsers)");
{
  const pos = fakePos();
  pos.charge();
  pos.back();
  pos.forward();
  check("the sheet does not reopen", pos.sheets.length === 0);
  pos.settle();
  check("the browser is stepped back out of the entry", pos.entry === 0 && pos.onPos);
}

console.log("\nThe rules, directly");
{
  check("nothing open, on the page's own entry: nothing to do", JSON.stringify(syncSheets(IDLE, 0, 0)) === JSON.stringify({ nav: IDLE, push: [], go: 0, close: 0, handled: false }));
  check("two sheets opened at once push marks 1 and 2", syncSheets(IDLE, 2, 0).push.join() === "1,2");
  check("a step back under way holds further changes", syncSheets({ target: 0 }, 2, 1).push.length === 0 && syncSheets({ target: 0 }, 2, 1).nav.target === 0);
  check("a pop on the page's own entry with nothing open is the browser's", sheetPop(IDLE, 0, 0).handled === false);
  check("a jump back over two entries closes two sheets", sheetPop(IDLE, 2, 0).close === 2);
  const landed = sheetPop({ target: 1 }, 1, 1);
  check("our own step landing closes nothing", landed.close === 0 && landed.handled && landed.nav.target === null);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
