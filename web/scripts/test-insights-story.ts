/**
 * Tests the words presentation mode writes from the Insights figures (src/lib/insights-story.ts).
 * Invented numbers only. No server or database needed.
 *
 *   npm run test:insights-story
 */
import {
  buildStory,
  emphasisRuns,
  peso,
  plain,
  type Story,
  type StoryChart,
  type StoryInput,
  type StorySlide,
  type StoryTrends,
} from "../src/lib/insights-story";

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

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

// 14 invented days, Sun Mar 1 to Sat Mar 14 2026: weekends ₱1,600 from 8 sales, weekdays ₱1,000 from 5.
function period(first = "2026-03-01", days = 14): StoryTrends["daily"] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    return isWeekend(date) ? { date, revenue: 1600, sales: 8 } : { date, revenue: 1000, sales: 5 };
  });
}

// Busiest 3 PM-6 PM (33 of 82), busiest hour 4-5 PM (12), quietest 10-11 AM (2).
const HOURS = [2, 3, 4, 6, 8, 10, 12, 11, 9, 7, 6, 4].map((sales, i) => ({ hour: 10 + i, sales }));

function trendsOf(daily: StoryTrends["daily"], change: Partial<StoryTrends> = {}): StoryTrends {
  const revenue = daily.reduce((sum, d) => sum + d.revenue, 0);
  const sales = daily.reduce((sum, d) => sum + d.sales, 0);
  const openDays = daily.filter((d) => d.sales > 0).length;
  return {
    first: daily[0].date,
    daily,
    hours: HOURS,
    hourExcluded: 0,
    byBarber: [
      { name: "Barber A", revenue: 9840, sales: 48 },
      { name: "Barber B", revenue: 6560, sales: 34 },
    ],
    byService: [
      { name: "Haircut", sales: 70 },
      { name: "Shave & Massage", sales: 12 },
    ],
    byMethod: [
      { label: "Cash", revenue: 11480, digital: false },
      { label: "GCash", revenue: 3280, digital: true },
      { label: "Maya", revenue: 1640, digital: true },
    ],
    revenue,
    sales,
    tips: 820,
    openDays,
    perOpenDay: openDays > 0 ? Math.round((revenue / openDays) * 100) / 100 : null,
    average: sales > 0 ? Math.round((revenue / sales) * 100) / 100 : null,
    previous: { revenue: 14000, sales: 75 },
    heldForReview: 0,
    ...change,
  };
}

function make(change: Partial<StoryInput> = {}): StoryInput {
  return {
    today: "2026-03-20",
    date: "2026-03-14",
    days: 14,
    manilaHour: 15,
    day: {
      revenue: 1600,
      sales: 8,
      average: 200,
      tips: 100,
      methods: [
        { label: "Cash", amount: 1200, digital: false },
        { label: "GCash", amount: 400, digital: true },
        { label: "Maya", amount: 0, digital: true },
      ],
      expectedDrawer: 700,
      drawer: null,
      barbers: [
        { name: "Barber A", sales: 5, earned: 550, remaining: 0, additionalOwed: false },
        { name: "Barber B", sales: 3, earned: 330, remaining: 330, additionalOwed: false },
      ],
      heldForReview: 0,
      pendingQrph: 0,
    },
    trends: trendsOf(period()),
    forecast: {
      run: { createdOn: "2026-03-10", avgTicket: 200, typicalError: 2.5, bestBaseline: "Average for that weekday", weeksWon: 1, weeksTested: 4 },
      days: [5, 6, 7, 8, 9, 10, 6].map((customers, i) => ({ date: addDays("2026-03-20", i), customers, revenue: customers * 200 })),
    },
    ...change,
  };
}

const withDay = (change: Partial<NonNullable<StoryInput["day"]>>) => ({ ...make().day!, ...change });
const slideOf = (story: Story, id: string) => story.slides.find((s) => s.id === id);
const texts = (slide: StorySlide | undefined) => [...(slide?.points ?? []).map((p) => p.text), ...(slide?.todo ?? []).map((t) => t.text)].map(plain);
const has = (slide: StorySlide | undefined, fragment: string) => texts(slide).some((text) => text.includes(fragment));
const headline = (slide: StorySlide | undefined) => plain(slide?.headline ?? "");
const marked = (text: string | undefined) => emphasisRuns(text ?? "").filter((run) => run.em).map((run) => run.text);
const chartOf = (slide: StorySlide | undefined, title: string): StoryChart | undefined => slide?.charts?.find((c) => c.title === title);
const show = (value: unknown) => JSON.stringify(value);

console.log("A closed past day");
const base = buildStory(make());
check("slides in order", base.slides.map((s) => s.id).join() === "summary,day,trend,hours,mix,forecast,todo", show(base.slides.map((s) => s.id)));
check("date line names the day and period", base.dateLine === "Saturday, March 14, 2026 · 14-day trend", base.dateLine);
const summary = slideOf(base, "summary")!;
check(
  "summary headline: period revenue and its change",
  headline(summary) === "₱16,400 from 82 paid sales in the 14 days to Mar 14, up 17% on the 14 days before.",
  headline(summary)
);
check("summary marks its key figures", show(marked(summary.headline)) === show(["₱16,400", "82", "17%"]), show(marked(summary.headline)));
check("revenue delta uses the page's words", summary.figures[0].delta?.text === "+17% vs the 14 days before" && summary.figures[0].delta?.trend === "up", show(summary.figures[0]));
check("summary's day figure is labelled with the date", summary.figures.some((f) => f.label === "Sat, Mar 14" && f.value === "₱1,600.00"), show(summary.figures));
check("summary shows the forecast week", summary.figures.some((f) => f.label === "Next 7 days" && f.value === "₱10,200"), show(summary.figures));
const day = slideOf(base, "day")!;
check("day title is the long date", day.title === "Saturday, Mar 14", day.title);
check("day compared with the period's other open days", headline(day) === "₱1,600.00 from 8 paid sales, 41% above a typical open day in this period (₱1,138).", headline(day));
check("day marks revenue, sales and the gap", show(marked(day.headline)) === show(["₱1,600.00", "8", "41%"]), show(marked(day.headline)));
check("payment mix in words", has(day, "Cash was 75% of revenue (₱1,200.00); the other 25% came by GCash and never enters the drawer."), show(texts(day)));
check("a closed day without a count says so", has(day, "No drawer count was saved for this day. Expected drawer cash: ₱700.00."), show(texts(day)));
check("one barber owed", has(day, "Barber B is still owed ₱330.00."), show(texts(day)));
check("sales by barber, most first", has(day, "Paid sales by barber: Barber A 5, Barber B 3."), show(texts(day)));
check("a closed day shows tips, not a pace", day.figures[3].label === "Tips to barbers" && !has(day, "At this pace"), show(day.figures[3]));
const trend = slideOf(base, "trend")!;
check("trend headline names the driver (volume)", headline(trend) === "Revenue rose 17% to ₱16,400, mostly from more paid sales (82 against 75).", headline(trend));
check("best day: ties go to the latest", has(trend, "Best day: Sat, Mar 14, ₱1,600.00 from 8 paid sales."), show(texts(trend)));
check("momentum: steady halves", has(trend, "Steady through the period: the later 7 days averaged ₱1,171 a day, about the same as the first 7."), show(texts(trend)));
check("the average per sale moved too", has(trend, "The average per sale went up from ₱187 to ₱200 (+7%)."), show(texts(trend)));
check("no gaps, no gap warning", !texts(trend).some((t) => t.includes("no paid sales recorded")));
const revenueChart = chartOf(trend, "Revenue per day");
check("trend chart emphasises the chosen day", revenueChart?.columns.filter((c) => c.emphasis).map((c) => c.key).join() === "2026-03-14");
check("trend chart: the days before as a level", revenueChart?.reference?.value === 1000 && revenueChart.reference.label === "The 14 days before: ₱1,000 a day", show(revenueChart?.reference));
check("trend chart: the best day tagged", revenueChart?.callout?.key === "2026-03-14" && revenueChart.callout.text === "Best · ₱1,600", show(revenueChart?.callout));
const hours = slideOf(base, "hours")!;
check("busiest three hours", headline(hours) === "Busiest from 3 to 6 PM: 40% of paid sales came in those 3 hours.", headline(hours));
check("the stretch and its share are marked", show(marked(hours.headline)) === show(["3 to 6 PM", "40%"]), show(marked(hours.headline)));
check("busiest and quietest weekday, weekends against weekdays", has(hours, "Saturdays were the busiest, at 8.0 paid sales an open day; Mondays the quietest, at 5.0. Weekends averaged 60% more paid sales a day than weekdays."), show(texts(hours)));
check("quietest hour in words; the busiest is tagged on the chart instead", has(hours, "quietest open hour was 10–11 AM, with 2 paid sales") && !has(hours, "single busiest hour"), show(texts(hours)));
check("before and after 4 PM", has(hours, "40% of paid sales came before 4 PM and 60% from 4 PM to closing."), show(texts(hours)));
check("a suggestion outside the busy stretch", hours.points.some((p) => p.tone === "idea" && p.text.startsWith("Plan breaks and errands outside 3 to 6 PM")), show(hours.points));
check("two charts: by weekday, then by hour", hours.charts?.map((c) => c.title).join() === "By day of the week,By hour of the day", show(hours.charts?.map((c) => c.title)));
const hourChart = chartOf(hours, "By hour of the day");
check("hour chart emphasises the whole stretch", hourChart?.columns.filter((c) => c.emphasis).map((c) => c.key).join() === "15,16,17");
check("hour chart tags the busiest hour", hourChart?.callout?.key === "16" && hourChart.callout.text === "Busiest · 12 sales", show(hourChart?.callout));
const weekChart = chartOf(hours, "By day of the week");
check("weekday chart: Monday first, Saturday tagged", weekChart?.columns.map((c) => c.axisLabel).join() === "Mon,Tue,Wed,Thu,Fri,Sat,Sun" && weekChart.callout?.text === "Busiest · 8.0", show(weekChart?.callout));
check("weekday chart: the average as a level", weekChart?.reference?.label === "Average 5.9", show(weekChart?.reference));
check("no figure strip on the hours slide", hours.figures.length === 0);
const mix = slideOf(base, "mix")!;
check("top barber's share", headline(mix) === "Barber A brought in 60% of revenue: ₱9,840 from 48 paid sales.", headline(mix));
check("average per sale by barber", has(mix, "Average per sale: Barber A ₱205 and Barber B ₱193."), show(texts(mix)));
check("shares are not a performance score", has(mix, "aren't a performance score"));
check("services are left to their bars", !has(mix, "of services sold") && mix.bars?.[1].items[0].share === 85.4, show(mix.bars?.[1].items[0]));
check("digital share in words", has(mix, "30% of revenue was paid by GCash and Maya; that money never enters the drawer."), show(texts(mix)));
check("tips in words", has(mix, "Customers tipped ₱820.00 on top, about 5% of revenue, and all of it goes to the barbers."), show(texts(mix)));
check("three bar groups", mix.bars?.map((b) => b.title).join() === "Revenue by barber,Services sold,Payment methods");
const forecast = slideOf(base, "forecast")!;
check("forecast headline", headline(forecast) === "About 51 customers expected over the next 7 days, worth around ₱10,200.", headline(forecast));
check("busiest and quietest forecast day", has(forecast, "Busiest Wed, Mar 25 (about 10), quietest Fri, Mar 20 (about 5)."), show(texts(forecast)));
check("few sales: the busiest hour is said in words", has(slideOf(buildStory(make({ trends: trendsOf(period(), { hours: HOURS.map((h) => ({ ...h, sales: h.hour === 15 ? 4 : 0 })) }) })), "hours"), "The single busiest hour was 3–4 PM, with 4 paid sales"));
check(
  "forecast against recent sales",
  has(forecast, "About 7.3 customers a day, 24% above the 5.9 paid sales an open day in the 14 days to Mar 14"),
  show(texts(forecast))
);
check("lost most test weeks: a rough guide, as a warning", forecast.points.some((p) => p.tone === "warn" && p.text.endsWith("Treat it as a rough guide.")), show(forecast.points));
check("forecast footnote explains the revenue", forecast.footnote?.startsWith("Expected revenue = expected customers × ₱200.00") === true, forecast.footnote);
const forecastChart = chartOf(forecast, "Expected customers per day");
check("forecast chart: recent sales as a level, busiest day tagged", forecastChart?.reference?.label === "Recent: 5.9 sales a day" && forecastChart.callout?.key === "2026-03-25" && forecastChart.callout.text === "Busiest · about 10", show([forecastChart?.reference, forecastChart?.callout]));
const todo = slideOf(base, "todo")!;
check("two things need attention", todo.title === "Needs attention" && headline(todo) === "2 things need attention.", `${todo.title} / ${headline(todo)}`);
check("count the drawer, with a link", todo.todo?.some((t) => plain(t.text) === "Count the drawer for Mar 14: no count was saved." && t.link?.href === "/reconciliation") === true, show(todo.todo));
check("pay out, with a link and the amount marked", todo.todo?.some((t) => t.text === "Pay out Barber B **₱330.00**." && t.link?.href === "/ledger") === true, show(todo.todo));
check("passed checks are listed", has(todo, "No sales are waiting for a date review.") && has(todo, "Paid sales were recorded on every day of the 14 days to Mar 14."), show(texts(todo)));
check("summary carries each slide's highlight", summary.points.length === 5 && plain(summary.points[4].text) === "2 things to look at: see the last slide.", show(summary.points));

console.log("\nWhat drove a change");
const steady = slideOf(buildStory(make({ trends: trendsOf(period(), { previous: { revenue: 16000, sales: 80 } }) })), "trend")!;
check("under 5% holds steady", headline(steady) === "Revenue held steady: ₱16,400 against ₱16,000 in the 14 days before.", headline(steady));
const ticket = slideOf(buildStory(make({ trends: trendsOf(period(), { previous: { revenue: 12000, sales: 82 } }) })), "trend")!;
check("same sales, higher average", headline(ticket) === "Revenue rose 37% to ₱16,400, mostly from a higher average per sale (₱146 to ₱200).", headline(ticket));
check("the headline already said it: no average-per-sale point", !has(ticket, "The average per sale went"), show(texts(ticket)));
const fewer = slideOf(buildStory(make({ trends: trendsOf(period(), { previous: { revenue: 20000, sales: 100 } }) })), "trend")!;
check("a fall from fewer sales", headline(fewer) === "Revenue fell 18% to ₱16,400, mostly from fewer paid sales (82 against 100).", headline(fewer));
const fellSummary = slideOf(buildStory(make({ trends: trendsOf(period(), { previous: { revenue: 20000, sales: 100 } }) })), "summary")!;
check("summary says down", headline(fellSummary).endsWith(", down 18% on the 14 days before.") && fellSummary.figures[0].delta?.text === "−18% vs the 14 days before", headline(fellSummary));

console.log("\nMomentum inside the period");
const rising = period().map((d, i) => ({ ...d, revenue: i < 7 ? 1000 : 1500 }));
check("picking up", has(slideOf(buildStory(make({ trends: trendsOf(rising) })), "trend"), "Picking up: the later 7 days averaged ₱1,500 a day, 50% more than the first 7."));
const falling = period().map((d, i) => ({ ...d, revenue: i < 7 ? 1500 : 1000 }));
const slowing = slideOf(buildStory(make({ trends: trendsOf(falling) })), "trend")!;
check("slowing down", has(slowing, "Slowing down: the later 7 days averaged ₱1,000 a day, 33% less than the first 7.") && slowing.points.some((p) => p.tone === "down"), show(texts(slowing)));
const week = slideOf(buildStory(make({ days: 7, trends: trendsOf(period("2026-03-08", 7)) })), "trend")!;
check("7 days: no momentum", !has(week, "the later") && !has(week, "Steady through"), show(texts(week)));

console.log("\nA fresh start and gaps");
const fresh = period().map((d, i) => (i < 3 ? { ...d, revenue: 0, sales: 0 } : d));
const freshStory = buildStory(make({ trends: trendsOf(fresh, { previous: { revenue: 0, sales: 0 } }) }));
check("nothing to compare with", headline(slideOf(freshStory, "summary")).endsWith("; the 14 days before had none to compare with."), headline(slideOf(freshStory, "summary")));
check("delta from nothing", slideOf(freshStory, "summary")!.figures[0].delta?.text === "Up from nothing in the 14 days before");
check("days before the first sale are the start, not gaps", has(slideOf(freshStory, "trend"), "The first paid sale in this period was on Wed, Mar 4") && !has(slideOf(freshStory, "trend"), "no paid sales recorded"), show(texts(slideOf(freshStory, "trend"))));
check("the to-do list doesn't flag them either", !has(slideOf(freshStory, "todo"), "Check ") && has(slideOf(freshStory, "todo"), "Paid sales were recorded every day since Mar 4."), show(texts(slideOf(freshStory, "todo"))));
check("no comparison: no level line on the chart", chartOf(slideOf(freshStory, "trend"), "Revenue per day")?.reference === undefined);
const gappy = period().map((d) => (d.date === "2026-03-03" || d.date === "2026-03-10" ? { ...d, revenue: 0, sales: 0 } : d));
const gapStory = buildStory(make({ trends: trendsOf(gappy) }));
check("gaps after sales began are flagged", has(slideOf(gapStory, "trend"), "2 days had no paid sales recorded: Tue, Mar 3 and Tue, Mar 10."), show(texts(slideOf(gapStory, "trend"))));
check("and listed to check", has(slideOf(gapStory, "todo"), "Check Tue, Mar 3 and Tue, Mar 10: no paid sales were recorded on those days"), show(texts(slideOf(gapStory, "todo"))));
const manyGaps = period().map((d, i) => (i % 2 === 1 ? { ...d, revenue: 0, sales: 0 } : d));
check("long gap lists are cut short", has(slideOf(buildStory(make({ trends: trendsOf(manyGaps) })), "trend"), "and 4 more"));

console.log("\nToday, still open");
const openToday = period().map((d) => (d.date === "2026-03-14" ? { ...d, revenue: 600, sales: 3 } : d));
const live = buildStory(make({ today: "2026-03-14", manilaHour: 15, trends: trendsOf(openToday), day: withDay({ revenue: 600, sales: 3, expectedDrawer: 400 }) }));
const liveDay = slideOf(live, "day")!;
check("title says so far", liveDay.title === "Today so far", liveDay.title);
check("compared with a typical day, as a share", headline(liveDay) === "₱600.00 from 3 paid sales so far, 53% of a typical open day in this period (₱1,138).", headline(liveDay));
check("pace: where today could end", has(liveDay, "At this pace, today could end near ₱2,350: by 3 PM the other days in this period had made 25% of their paid sales."), show(texts(liveDay)));
check("pace replaces tips in the strip", liveDay.figures[3].label === "Pace for today" && liveDay.figures[3].value === "₱2,350", show(liveDay.figures[3]));
check("drawer not counted yet is not a warning", liveDay.points.some((p) => p.tone === "info" && plain(p.text) === "Expected in the drawer so far: ₱400.00. It is counted at closing."), show(liveDay.points));
check("payout before going home", has(liveDay, "Earned and not paid out yet: Barber B ₱330.00."), show(texts(liveDay)));
check("trend notes the open day", has(slideOf(live, "trend"), "Today is still open"));
check("momentum leaves the open day out", has(slideOf(live, "trend"), "Steady through the period: the later 6 days averaged ₱1,100 a day, about the same as the first 7."), show(texts(slideOf(live, "trend"))));
check("weekdays from full days only: Sunday leads", has(slideOf(live, "hours"), "Sundays were the busiest, at 8.0 paid sales an open day"), show(texts(slideOf(live, "hours"))));
check("to-do: pay before going home, no drawer item", has(slideOf(live, "todo"), "Before each barber goes home") && !has(slideOf(live, "todo"), "Count the drawer"), show(texts(slideOf(live, "todo"))));
const morning = buildStory(make({ today: "2026-03-14", manilaHour: 11, trends: trendsOf(openToday), day: withDay({ revenue: 600, sales: 3 }) }));
check("no pace in the first two hours", !has(slideOf(morning, "day"), "At this pace") && slideOf(morning, "day")!.figures[3].label === "Tips to barbers");
const thin = buildStory(make({ today: "2026-03-14", manilaHour: 15, trends: trendsOf(openToday, { hours: HOURS.map((h) => ({ ...h, sales: Math.min(h.sales, 2) })) }), day: withDay({ revenue: 600, sales: 3 }) }));
check("no pace without enough history", !has(slideOf(thin, "day"), "At this pace"));
const emptyToday = period().map((d) => (d.date === "2026-03-14" ? { ...d, revenue: 0, sales: 0 } : d));
const quietMorning = buildStory(make({ today: "2026-03-14", manilaHour: 9, trends: trendsOf(emptyToday), day: withDay({ revenue: 0, sales: 0, barbers: [] }) }));
check("no sales yet today", headline(slideOf(quietMorning, "day")).startsWith("No paid sales yet today."));
check("an open day without sales is not a gap", !has(slideOf(quietMorning, "trend"), "no paid sales recorded"), show(texts(slideOf(quietMorning, "trend"))));
const closed = buildStory(make({ today: "2026-03-14", manilaHour: 22 }));
check("after 10 PM today is complete", slideOf(closed, "day")!.title === "Today" && !has(slideOf(closed, "trend"), "still open") && !has(slideOf(closed, "day"), "At this pace"));

console.log("\nThe drawer");
const balanced = buildStory(make({ day: withDay({ drawer: { status: "balanced", variance: 0, stale: false, revision: 1 } }) }));
check("balanced: a good point and a passed check", has(slideOf(balanced, "day"), "The drawer count balanced (revision 1).") && has(slideOf(balanced, "todo"), "The drawer count balanced."));
const short = buildStory(make({ day: withDay({ drawer: { status: "short", variance: -50, stale: false, revision: 2 } }) }));
check("short, in pesos", has(slideOf(short, "day"), "The drawer was ₱50.00 short when it was counted (revision 2).") && has(slideOf(short, "todo"), "Look into the drawer: it was ₱50.00 short"), show(texts(slideOf(short, "todo"))));
const stale = buildStory(make({ day: withDay({ drawer: { status: "balanced", variance: 0, stale: true, revision: 3 } }) }));
check("stale count: count again", has(slideOf(stale, "todo"), "Count the drawer again") && has(slideOf(stale, "day"), "revision 3) is out of date"));

console.log("\nPayouts and held sales");
const extra = buildStory(make({ day: withDay({ barbers: [{ name: "Barber B", sales: 3, earned: 430, remaining: 100, additionalOwed: true }] }) }));
check("additional owed", has(slideOf(extra, "todo"), "Pay Barber B the extra ₱100.00: sales were counted after the payout was marked paid."), show(texts(slideOf(extra, "todo"))));
const paid = buildStory(make({ day: withDay({ barbers: [{ name: "Barber A", sales: 8, earned: 880, remaining: 0, additionalOwed: false }] }) }));
check("all paid out", has(slideOf(paid, "day"), "Every barber's earnings for the day are paid out.") && has(slideOf(paid, "todo"), "Every barber's earnings are paid out."));
const held = buildStory(make({ day: withDay({ heldForReview: 1, pendingQrph: 2 }), trends: trendsOf(period(), { heldForReview: 3 }) }));
check("held on the day", has(slideOf(held, "todo"), "Confirm the date of 1 sale stamped on Mar 14: it is held for review"), show(texts(slideOf(held, "todo"))));
check("held elsewhere in the period", has(slideOf(held, "todo"), "2 more sales elsewhere in the 14 days to Mar 14 are held for a date review."), show(texts(slideOf(held, "todo"))));
check("pending QR Ph", has(slideOf(held, "todo"), "2 QR Ph sales on Mar 14 are not confirmed paid yet"));
check("the day's figures say what they leave out", has(slideOf(held, "day"), "These figures leave out 1 sale held for a date review and 2 QR Ph sales not confirmed paid."), show(texts(slideOf(held, "day"))));

console.log("\nThe forecast");
check("can't load", headline(slideOf(buildStory(make({ forecast: null })), "forecast")) === "The saved forecast can't be loaded right now.");
const none = buildStory(make({ forecast: { run: null, days: [] } }));
check("none saved yet", headline(slideOf(none, "forecast")) === "No forecast has been saved yet." && has(slideOf(none, "todo"), "Make the first forecast"));
check("no forecast: the summary shows the average per sale instead", slideOf(none, "summary")!.figures.some((f) => f.label === "Average per sale"));
const notToday = buildStory(make({ forecast: { run: make().forecast!.run, days: [] } }));
check("doesn't cover today", headline(slideOf(notToday, "forecast")) === "The saved forecast doesn't cover today yet.");
const shortRun = buildStory(make({ forecast: { run: make().forecast!.run, days: make().forecast!.days.slice(0, 3) } }));
check("a short forecast asks for a refresh", slideOf(shortRun, "forecast")!.title === "Next 3 days" && has(slideOf(shortRun, "forecast"), "runs out after 3 days") && has(slideOf(shortRun, "todo"), "Refresh the forecast"));
const winning = slideOf(buildStory(make({ forecast: { run: { ...make().forecast!.run!, weeksWon: 3 }, days: make().forecast!.days } })), "forecast")!;
check("won most weeks: no rough-guide warning", !winning.points.some((p) => p.tone === "warn") && has(winning, "in 3 of 4."), show(winning.points));

console.log("\nEmpty and unreachable");
const empty = buildStory(make({ trends: trendsOf(period().map((d) => ({ ...d, revenue: 0, sales: 0 })), { previous: { revenue: 0, sales: 0 } }), day: withDay({ revenue: 0, sales: 0, barbers: [] }) }));
check("no hours or mix slides without sales", empty.slides.map((s) => s.id).join() === "summary,day,trend,forecast,todo", show(empty.slides.map((s) => s.id)));
check("summary says no sales", headline(slideOf(empty, "summary")) === "No paid sales were recorded in the 14 days to Mar 14.");
const down = buildStory(make({ day: null, trends: null, forecast: null }));
check("database down: the summary says so", headline(slideOf(down, "summary")) === "The figures can't be loaded right now: the database is unreachable.");
check("database down: the list may be incomplete", has(slideOf(down, "todo"), "Some figures couldn't be loaded") && headline(slideOf(down, "todo")) === "Nothing to flag in the figures that loaded.");

console.log("\nEdge cases");
const even = slideOf(buildStory(make({ trends: trendsOf(period(), { byBarber: [{ name: "Barber A", revenue: 8200, sales: 41 }, { name: "Barber B", revenue: 8200, sales: 41 }] }) })), "mix")!;
check("an even split", headline(even) === "Revenue was split almost evenly: Barber A 50% and Barber B 50%.", headline(even));
const solo = slideOf(buildStory(make({ trends: trendsOf(period(), { byBarber: [{ name: "Barber A", revenue: 16400, sales: 82 }] }) })), "mix")!;
check("one barber: no share caveat", headline(solo).startsWith("Barber A rang up every paid sale") && !has(solo, "performance score"));
const services = ["A", "B", "C", "D", "E", "F", "G"].map((name, i) => ({ name: `Service ${name}`, sales: 20 - i }));
const capped = slideOf(buildStory(make({ trends: trendsOf(period(), { byService: services }) })), "mix")!.bars![1].items;
check("long bar lists end in Others", capped.length === 5 && capped[4].label === "Others" && capped[4].note === "3 more" && capped[4].valueText === "45 sales", show(capped[4]));
const noTips = slideOf(buildStory(make({ trends: trendsOf(period(), { tips: 0 }) })), "mix")!;
check("no tips, no tips point", !has(noTips, "tipped"));
const flatHours = Array.from({ length: 12 }, (_, i) => ({ hour: 10 + i, sales: 5 }));
const flat = slideOf(buildStory(make({ trends: trendsOf(period(), { hours: flatHours }) })), "hours")!;
check("ties: the earliest stretch and hour", headline(flat).startsWith("Busiest from 10 AM to 1 PM") && chartOf(flat, "By hour of the day")?.callout?.key === "10", headline(flat));
const early = slideOf(buildStory(make({ trends: trendsOf(period(), { hours: [{ hour: 9, sales: 1 }, ...HOURS] }) })), "hours")!;
check("sales outside opening hours", has(early, "1 sale was rung up outside opening hours"));
const few = slideOf(buildStory(make({ trends: trendsOf(period(), { hours: HOURS.map((h) => ({ ...h, sales: h.hour === 15 ? 4 : 0 })) }) })), "hours")!;
check("few sales: an early read, no suggestion", headline(few).startsWith("Only 4 sales with a known time so far") && !few.points.some((p) => p.tone === "idea"), headline(few));
check("few sales: no quietest hour or halves of the day", !has(few, "quietest open hour") && !has(few, "before 4 PM"), show(texts(few)));
const weekOnly = slideOf(buildStory(make({ days: 7, trends: trendsOf(period("2026-03-08", 7)) })), "hours")!;
check("7 days: hours only, no weekday chart", weekOnly.charts?.length === 1 && !has(weekOnly, "were the busiest"), show(weekOnly.charts?.map((c) => c.title)));
const cash = slideOf(buildStory(make({ day: withDay({ methods: [{ label: "Cash", amount: 1600, digital: false }] }) })), "day")!;
check("all cash", has(cash, "Every sale was paid in cash."));
const month = slideOf(buildStory(make({ days: 30, trends: trendsOf(period("2026-02-13", 30)) })), "hours")!;
check("30 days: the busiest weekday", has(month, "Saturdays were the busiest, at 8.0 paid sales an open day; Mondays the quietest, at 5.0."), show(texts(month)));
check("peso formatting", peso(-1234.5) === "−₱1,234.50" && peso(-0.004) === "₱0.00" && peso(1234567.891) === "₱1,234,567.89", `${peso(-1234.5)} ${peso(-0.004)}`);
check(
  "emphasis runs and plain text",
  show(emphasisRuns("Up **17%** to **₱16,400**, mostly")) === show([{ text: "Up ", em: false }, { text: "17%", em: true }, { text: " to ", em: false }, { text: "₱16,400", em: true }, { text: ", mostly", em: false }]) &&
    plain("Up **17%** to **₱16,400**.") === "Up 17% to ₱16,400.",
  show(emphasisRuns("Up **17%** to **₱16,400**, mostly"))
);
check("same figures, same words", JSON.stringify(buildStory(make())) === JSON.stringify(base));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
