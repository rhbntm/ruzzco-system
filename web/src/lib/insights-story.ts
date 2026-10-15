// Presentation mode on /insights: a short summary of the page's figures for the owner, with the
// sentences written from the results by fixed rules. No AI service writes them: the shop's
// figures never leave its own server, and the same figures always give the same words. Pure
// functions (no I/O), so the wording is tested without a browser or a database
// (npm run test:insights-story). Money arrives already summed exactly (Prisma Decimal) by the
// page; here it is only compared, shared out and formatted for reading.
// The key figures in headlines, points and to-dos are marked **like this**: the presentation rolls
// them in on register wheels (headlines) or sets them in bold (points). plain() drops the marks.
import type { BarItem } from "@/components/BarList";
import type { Column } from "@/components/ColumnChart";

// ── Input: the page's figures as plain numbers ───────────────────────────────

export type StoryInput = {
  today: string; // today's Manila business date
  date: string; // the chosen business day
  days: number; // the trend period: this many days up to and including `date`
  manilaHour: number; // the hour now in Manila (0-23)
  day: StoryDay | null; // null: the database is unreachable
  trends: StoryTrends | null; // null: the database is unreachable
  forecast: StoryForecast | null; // null: the saved forecast can't be loaded
};

export type StoryDay = {
  revenue: number;
  sales: number; // paid sales
  average: number | null; // revenue ÷ paid sales, rounded as the page rounds it
  tips: number;
  methods: { label: string; amount: number; digital: boolean }[];
  expectedDrawer: number;
  // The latest saved drawer count, if any.
  drawer: { status: "balanced" | "short" | "over"; variance: number; stale: boolean; revision: number } | null;
  barbers: { name: string; sales: number; earned: number; remaining: number; additionalOwed: boolean }[];
  heldForReview: number;
  pendingQrph: number;
};

export type StoryTrends = {
  first: string;
  daily: { date: string; revenue: number; sales: number }[]; // every day of the period, oldest first
  hours: { hour: number; sales: number }[]; // consecutive hours, at least 10 AM-10 PM
  hourExcluded: number;
  byBarber: { name: string; revenue: number; sales: number }[]; // highest revenue first
  byService: { name: string; sales: number }[]; // most sold first
  byMethod: { label: string; revenue: number; digital: boolean }[];
  revenue: number;
  sales: number;
  tips: number;
  openDays: number;
  perOpenDay: number | null;
  average: number | null;
  previous: { revenue: number; sales: number }; // the same number of days just before
  heldForReview: number;
};

export type StoryForecast = {
  run: {
    createdOn: string;
    avgTicket: number;
    typicalError: number; // customers a day, on the test weeks
    bestBaseline: string; // the best simple guess, in plain words
    weeksWon: number;
    weeksTested: number;
  } | null;
  days: { date: string; customers: number; revenue: number }[]; // from today on, up to 7
};

// ── Output: the slides ───────────────────────────────────────────────────────

// up, down, flat: a change. good: checked and fine. warn: needs the owner. idea: a suggestion.
// info: a plain fact.
export type Tone = "up" | "down" | "flat" | "good" | "warn" | "idea" | "info";
export type StoryPoint = { tone: Tone; text: string };
export type StoryDelta = { text: string; trend: "up" | "down" | "flat" };
export type StoryFigure = { label: string; value: string; note?: string; money?: boolean; delta?: StoryDelta };
export type StoryChart = {
  title: string;
  columns: Column[];
  unit: "peso" | "count";
  summary: string;
  labelHeading: string;
  valueHeading: string;
  labelEvery?: number;
  reference?: { value: number; label: string }; // a dashed level to read the columns against
  callout?: { key: string; text: string }; // a tag pinned over the column the slide is about
};
export type StoryBars = { title: string; items: BarItem[] };
export type StoryTodo = { text: string; link?: { href: string; label: string } };
export type StorySlide = {
  id: string;
  title: string;
  headline: string; // the one sentence the slide is there to say
  figures: StoryFigure[];
  points: StoryPoint[];
  charts?: StoryChart[];
  bars?: StoryBars[];
  todo?: StoryTodo[];
  footnote?: string;
};
export type Story = { dateLine: string; slides: StorySlide[] };

// ── Emphasis ─────────────────────────────────────────────────────────────────

const MARK = /\*\*(.+?)\*\*/g;

// Marks a key figure.
function em(text: string) {
  return `**${text}**`;
}

// The text without its marks, for tests and anything read as plain text.
export function plain(text: string) {
  return text.replace(MARK, "$1");
}

// The text as runs in order, each marked as a key figure or not.
export function emphasisRuns(text: string): { text: string; em: boolean }[] {
  const runs: { text: string; em: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    const start = match.index ?? 0;
    if (start > last) runs.push({ text: text.slice(last, start), em: false });
    runs.push({ text: match[1], em: true });
    last = start + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), em: false });
  return runs;
}

// ── Rules ────────────────────────────────────────────────────────────────────

const OPEN_HOUR = 10; // open 10 AM-10 PM daily, holidays included
const CLOSE_HOUR = 22;
const STEADY = 5; // a change under 5% reads as "held steady"
const NOTABLE = 10; // a gap under 10% reads as "about the same"
const STRETCH_HOURS = 3; // the busiest stretch is read over this many hours in a row
const ENOUGH_SALES = 10; // fewer sales with a known hour than this is too few to read a pattern
const PACE_SALES = 30; // the other days' sales needed before today's pace is projected
const MAX_BARS = 5; // longer bar lists end in "Others"
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first

type Day = StoryTrends["daily"][number];
type Built = { slide: StorySlide; highlight?: StoryPoint };

type Ctx = {
  input: StoryInput;
  isToday: boolean;
  inProgress: boolean; // today before closing: the day's figures are not final yet
  dayLabel: string; // "Today so far", "Today" or "Tue, Oct 13"
  period: string; // "the last 14 days" or "the 14 days to Oct 13"
  before: string; // "the 14 days before"
  complete: Day[]; // the period's days, without today while it is still open
};

export function buildStory(input: StoryInput): Story {
  const ctx = context(input);
  const day = daySlide(ctx);
  const trend = trendSlide(ctx);
  const hours = hoursSlide(ctx);
  const mix = mixSlide(ctx);
  const forecast = forecastSlide(ctx);
  const todo = todoSlide(ctx);
  const summary = summarySlide(ctx, [day, hours, mix, forecast, todo]);
  return {
    dateLine: `${formatDate(input.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${input.days}-day trend`,
    slides: [summary, day, trend, hours, mix, forecast, todo].filter((built): built is Built => built !== null).map((built) => built.slide),
  };
}

function context(input: StoryInput): Ctx {
  const isToday = input.date === input.today;
  const inProgress = isToday && input.manilaHour < CLOSE_HOUR;
  return {
    input,
    isToday,
    inProgress,
    dayLabel: isToday ? (inProgress ? "Today so far" : "Today") : dayName(input.date),
    period: isToday ? `the last ${input.days} days` : `the ${input.days} days to ${shortDate(input.date)}`,
    before: `the ${input.days} days before`,
    complete: (input.trends?.daily ?? []).filter((d) => !(inProgress && d.date === input.date)),
  };
}

function slide(id: string, title: string, headline: string, rest: Partial<StorySlide> = {}): StorySlide {
  return { id, title, headline, figures: [], points: [], ...rest };
}

// ── Slides ───────────────────────────────────────────────────────────────────

function summarySlide(ctx: Ctx, parts: (Built | null)[]): Built {
  const { trends: t, day, forecast, days } = ctx.input;
  let headline: string;
  if (t && t.sales > 0) {
    headline = `${em(wholePeso(t.revenue))} from ${countOf(t.sales, "paid sale")} in ${ctx.period}${versus(t.revenue, t.previous.revenue, ctx.before)}.`;
  } else if (t) {
    headline = `No paid sales were recorded in ${ctx.period}.`;
  } else if (day) {
    headline = "The trend figures can't be loaded right now, so this covers the chosen day only.";
  } else {
    headline = "The figures can't be loaded right now: the database is unreachable.";
  }

  const figures: StoryFigure[] = [];
  if (t) {
    figures.push({ label: `Revenue, ${days} days`, value: peso(t.revenue), money: true, delta: delta(t.revenue, t.previous.revenue, days) });
    figures.push({ label: "Paid sales", value: String(t.sales), delta: delta(t.sales, t.previous.sales, days) });
  }
  if (day) figures.push({ label: ctx.dayLabel, value: peso(day.revenue), note: plural(day.sales, "paid sale") });
  const ahead = forecastTotals(forecast);
  if (ahead) {
    figures.push({ label: `Next ${ahead.days} ${ahead.days === 1 ? "day" : "days"}`, value: wholePeso(ahead.revenue), note: `About ${Math.round(ahead.customers)} customers expected` });
  } else if (t?.average != null) {
    figures.push({ label: "Average per sale", value: peso(t.average), note: `Over ${days} days` });
  }

  const points = parts.flatMap((part) => (part?.highlight ? [part.highlight] : []));
  return { slide: slide("summary", "At a glance", headline, { figures, points }) };
}

function daySlide(ctx: Ctx): Built {
  const { day, date } = ctx.input;
  const title = ctx.isToday ? ctx.dayLabel : formatDate(date, { weekday: "long", month: "short", day: "numeric" });
  if (!day) return { slide: slide("day", title, "This day's figures can't be loaded right now: the database is unreachable.") };

  let headline: string;
  let highlight: StoryPoint;
  if (day.sales === 0) {
    headline = ctx.inProgress
      ? "No paid sales yet today. Sales rung up offline show here once the phones sync."
      : "No paid sales were recorded on this day.";
    highlight = { tone: ctx.inProgress ? "info" : "warn", text: `${ctx.dayLabel}: no paid sales${ctx.inProgress ? " yet" : ""}.` };
  } else {
    // Against the period's other complete open days, so the day is never compared with itself.
    const others = ctx.complete.filter((d) => d.date !== date && d.sales > 0);
    const typical = others.length >= 3 ? average(others.map((d) => d.revenue)) : null;
    let comparison = "";
    let tone: Tone = "info";
    if (typical !== null && typical > 0) {
      const typicalText = `a typical open day in this period (${wholePeso(typical)})`;
      if (ctx.inProgress) {
        const reached = Math.round((day.revenue / typical) * 100);
        comparison = reached >= 100 ? `already past ${typicalText}` : `${em(`${reached}%`)} of ${typicalText}`;
        tone = reached >= 100 ? "up" : "info";
      } else {
        const gap = percentChange(day.revenue, typical);
        comparison = Math.abs(gap) < NOTABLE ? `close to ${typicalText}` : `${em(`${Math.abs(gap)}%`)} ${gap > 0 ? "above" : "below"} ${typicalText}`;
        tone = Math.abs(gap) < NOTABLE ? "flat" : gap > 0 ? "up" : "down";
      }
    }
    const result = `${em(peso(day.revenue))} from ${countOf(day.sales, "paid sale")}${ctx.inProgress ? " so far" : ""}`;
    headline = `${result}${comparison ? `, ${comparison}` : ""}.`;
    highlight = { tone, text: `${ctx.isToday ? "Today" : ctx.dayLabel}: ${result}${comparison ? `, ${comparison}` : ""}.` };
  }

  const points: StoryPoint[] = [];
  const left = [
    day.heldForReview > 0 ? `${plural(day.heldForReview, "sale")} held for a date review` : "",
    day.pendingQrph > 0 ? `${plural(day.pendingQrph, "QR Ph sale")} not confirmed paid` : "",
  ].filter(Boolean);
  if (left.length > 0) points.push({ tone: "warn", text: `These figures leave out ${list(left)}.` });

  const projection = pace(ctx);
  if (projection) {
    points.push({
      tone: "info",
      text: `At this pace, today could end near ${em(wholePeso(projection.projected))}: by ${clockHour(projection.hour)} the other days in this period had made ${Math.round(projection.share * 100)}% of their paid sales.`,
    });
  }

  if (day.revenue > 0) {
    const cash = sum(day.methods.filter((m) => !m.digital).map((m) => m.amount));
    const digital = day.methods.filter((m) => m.digital && m.amount > 0);
    if (digital.length === 0) {
      points.push({ tone: "info", text: "Every sale was paid in cash." });
    } else if (cash <= 0) {
      points.push({ tone: "info", text: `Every sale was paid by ${list(digital.map((m) => m.label))}, so none of it is in the drawer.` });
    } else {
      const cashShare = percentOf(cash, day.revenue);
      points.push({
        tone: "info",
        text: `Cash was ${em(`${cashShare}%`)} of revenue (${peso(cash)}); the other ${100 - cashShare}% came by ${list(digital.map((m) => m.label))} and never enters the drawer.`,
      });
    }
  }

  const drawer = day.drawer;
  if (drawer?.stale) {
    points.push({ tone: "warn", text: `The saved drawer count (revision ${drawer.revision}) is out of date: sales changed after it was saved. Expected drawer cash is now ${em(peso(day.expectedDrawer))}.` });
  } else if (drawer?.status === "balanced") {
    points.push({ tone: "good", text: `The drawer count balanced (revision ${drawer.revision}).` });
  } else if (drawer) {
    points.push({ tone: "warn", text: `The drawer was ${em(peso(Math.abs(drawer.variance)))} ${drawer.status} when it was counted (revision ${drawer.revision}).` });
  } else if (day.sales > 0) {
    points.push(
      ctx.inProgress
        ? { tone: "info", text: `Expected in the drawer so far: ${em(peso(day.expectedDrawer))}. It is counted at closing.` }
        : { tone: "warn", text: `No drawer count was saved for this day. Expected drawer cash: ${em(peso(day.expectedDrawer))}.` }
    );
  }

  const owed = day.barbers.filter((b) => b.remaining > 0);
  if (owed.length > 0) {
    const who = list(owed.map((b) => `${b.name} ${em(peso(b.remaining))}`));
    points.push(
      ctx.inProgress
        ? { tone: "info", text: `Earned and not paid out yet: ${who}. Each barber is paid before going home.` }
        : owed.length === 1
        ? { tone: "warn", text: `${owed[0].name} is still owed ${em(peso(owed[0].remaining))}.` }
        : { tone: "warn", text: `${em(peso(sum(owed.map((b) => b.remaining))))} is still to be paid out: ${list(owed.map((b) => `${b.name} ${peso(b.remaining)}`))}.` }
    );
  } else if (day.barbers.some((b) => b.earned > 0)) {
    points.push({ tone: "good", text: "Every barber's earnings for the day are paid out." });
  }

  const working = day.barbers.filter((b) => b.sales > 0).sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name));
  if (working.length >= 2) points.push({ tone: "info", text: `Paid sales by barber: ${working.map((b) => `${b.name} ${b.sales}`).join(", ")}.` });

  const figures: StoryFigure[] = [
    { label: "Revenue", value: peso(day.revenue), money: true, note: "Tips not included" },
    { label: "Paid sales", value: String(day.sales) },
    { label: "Average per sale", value: day.average !== null ? peso(day.average) : "—" },
    projection
      ? { label: "Pace for today", value: wholePeso(projection.projected), note: "A rough projection" }
      : { label: "Tips to barbers", value: peso(day.tips), note: "All payment methods" },
  ];
  return { slide: slide("day", title, headline, { figures, points }), highlight };
}

function trendSlide(ctx: Ctx): Built {
  const { trends: t, days, date } = ctx.input;
  const title = ctx.isToday ? `Last ${days} days` : `${days} days to ${shortDate(date)}`;
  if (!t) return { slide: slide("trend", title, "The trend figures can't be loaded right now: the database is unreachable.") };
  if (t.sales === 0) return { slide: slide("trend", title, `No paid sales in ${ctx.period}. Pick another day or a longer period on the page.`) };

  const prev = t.previous;
  let headline: string;
  let driver: "volume" | "ticket" | null = null;
  if (prev.sales === 0 || prev.revenue <= 0) {
    headline = `${em(wholePeso(t.revenue))} from ${countOf(t.sales, "paid sale")}. ${capitalize(ctx.before)} had no paid sales, so there is nothing to compare with yet.`;
  } else if (t.revenue <= 0) {
    headline = `${em(wholePeso(t.revenue))} from ${countOf(t.sales, "paid sale")}, against ${wholePeso(prev.revenue)} in ${ctx.before}.`;
  } else {
    const change = percentChange(t.revenue, prev.revenue);
    if (Math.abs(change) < STEADY) {
      headline = `Revenue held steady: ${em(wholePeso(t.revenue))} against ${wholePeso(prev.revenue)} in ${ctx.before}.`;
    } else {
      // Revenue = paid sales × average per sale, so its change splits into those two ratios.
      // The one that moved more (in log terms, so the parts add up) is named as the driver; it
      // always moved the same way as revenue.
      const volume = t.sales / prev.sales;
      const ticket = t.revenue / t.sales / (prev.revenue / prev.sales);
      driver = Math.abs(Math.log(volume)) >= Math.abs(Math.log(ticket)) ? "volume" : "ticket";
      const cause =
        driver === "volume"
          ? `${volume > 1 ? "more" : "fewer"} paid sales (${t.sales} against ${prev.sales})`
          : `a ${ticket > 1 ? "higher" : "lower"} average per sale (${wholePeso(prev.revenue / prev.sales)} to ${wholePeso(t.revenue / t.sales)})`;
      headline = `Revenue ${change > 0 ? "rose" : "fell"} ${em(`${Math.abs(change)}%`)} to ${em(wholePeso(t.revenue))}, mostly from ${cause}.`;
    }
  }

  const points: StoryPoint[] = [];
  // Ties: the most recent day, as on the page.
  const best = t.daily.reduce<Day | null>((top, d) => (d.sales > 0 && (!top || d.revenue >= top.revenue) ? d : top), null);
  if (best) points.push({ tone: "up", text: `Best day: ${dayName(best.date)}, ${em(peso(best.revenue))} from ${plural(best.sales, "paid sale")}.` });

  const swing = momentum(ctx);
  if (swing) points.push(swing);

  // When the headline names volume as the driver (or revenue held), the average per sale may still have moved.
  if (driver !== "ticket" && prev.sales > 0 && prev.revenue > 0 && t.revenue > 0) {
    const before = prev.revenue / prev.sales;
    const now = t.revenue / t.sales;
    const change = percentChange(now, before);
    if (Math.abs(change) >= STEADY) {
      points.push({
        tone: change > 0 ? "up" : "down",
        text: `The average per sale went ${change > 0 ? "up" : "down"} from ${wholePeso(before)} to ${em(wholePeso(now))} (${change > 0 ? "+" : "−"}${Math.abs(change)}%).`,
      });
    }
  }

  const { start, gaps } = quietDays(ctx);
  if (start) points.push({ tone: "info", text: `The first paid sale in this period was on ${dayName(start)}; the days before it have none recorded.` });
  if (gaps.length > 0) {
    points.push({
      tone: "warn",
      text: `${gaps.length === 1 ? "One day" : `${em(String(gaps.length))} days`} had no paid sales recorded: ${someDates(gaps)}. The shop opens every day, so check that those sales were rung up and synced.`,
    });
  }
  if (ctx.inProgress) points.push({ tone: "info", text: "Today is still open, so its column is not a full day yet." });
  if (t.heldForReview > 0) {
    points.push({ tone: "warn", text: `${plural(t.heldForReview, "sale")} in these days ${t.heldForReview === 1 ? "is" : "are"} held for a date review and not counted yet.` });
  }

  const previousAverage = prev.sales > 0 ? prev.revenue / prev.sales : null;
  const figures: StoryFigure[] = [
    { label: "Revenue", value: peso(t.revenue), money: true, delta: delta(t.revenue, prev.revenue, days) },
    { label: "Paid sales", value: String(t.sales), delta: delta(t.sales, prev.sales, days) },
    { label: "Average per open day", value: t.perOpenDay !== null ? peso(t.perOpenDay) : "—", note: `${t.openDays} of ${days} days had sales` },
    {
      label: "Average per sale",
      value: t.average !== null ? peso(t.average) : "—",
      note: previousAverage !== null ? `${wholePeso(previousAverage)} in ${ctx.before}` : "Revenue ÷ paid sales",
    },
  ];

  const period = `${shortDate(t.first)} – ${formatDate(date, { month: "short", day: "numeric", year: "numeric" })}`;
  const chart: StoryChart = {
    title: "Revenue per day",
    columns: t.daily.map((d) => ({
      key: d.date,
      axisLabel: days === 7 ? formatDate(d.date, { weekday: "short" }) : String(Number(d.date.slice(8))),
      label: dayName(d.date),
      value: d.revenue,
      valueText: peso(d.revenue),
      detail: plural(d.sales, "paid sale"),
      emphasis: d.date === date,
    })),
    unit: "peso",
    summary: `Revenue per day, ${period}.${best ? ` Highest ${peso(best.revenue)} on ${dayName(best.date)}.` : ""} Total ${peso(t.revenue)}.${prev.revenue > 0 ? ` ${capitalize(ctx.before)} averaged ${wholePeso(prev.revenue / days)} a day.` : ""}`,
    labelHeading: "Day",
    valueHeading: "Revenue",
    labelEvery: days === 7 ? 1 : days === 14 ? 2 : 5,
    // The days before, as a level a day: columns above it beat that period's pace.
    reference: prev.revenue > 0 ? { value: prev.revenue / days, label: `${capitalize(ctx.before)}: ${wholePeso(prev.revenue / days)} a day` } : undefined,
    callout: best ? { key: best.date, text: `Best · ${wholePeso(best.revenue)}` } : undefined,
  };
  return { slide: slide("trend", title, headline, { figures, points, charts: [chart] }) };
}

function hoursSlide(ctx: Ctx): Built | null {
  const t = ctx.input.trends;
  if (!t || t.sales === 0) return null;
  const known = sum(t.hours.map((h) => h.sales));
  if (known === 0) return null;

  // The busiest run of hours in a row; ties: the earliest.
  const width = Math.min(STRETCH_HOURS, t.hours.length);
  let start = 0;
  let most = -1;
  for (let i = 0; i + width <= t.hours.length; i++) {
    const count = sum(t.hours.slice(i, i + width).map((h) => h.sales));
    if (count > most) {
      most = count;
      start = i;
    }
  }
  const from = t.hours[start].hour;
  const to = from + width;
  const stretch = hourSpan(from, to);
  const stretchShare = percentOf(most, known);
  // Ties: the earliest hour.
  const peak = t.hours.reduce((top, h) => (h.sales > top.sales ? h : top));
  const quiet = t.hours.filter((h) => h.hour >= OPEN_HOUR && h.hour < CLOSE_HOUR).reduce((low, h) => (h.sales < low.sales ? h : low));
  const enough = known >= ENOUGH_SALES;

  const headline = enough
    ? `Busiest from ${em(stretch)}: ${em(`${stretchShare}%`)} of paid sales came in those ${width} hours.`
    : `Only ${countOf(known, "sale")} with a known time so far, so this is an early read. The busiest stretch was ${em(stretch)}.`;

  const week = weekProfile(ctx);
  const points: StoryPoint[] = [];
  if (week?.point) points.push(week.point);
  // The single busiest hour is tagged on the chart, so it is said here only on an early read.
  if (!enough) points.push({ tone: "up", text: `The single busiest hour was ${hourRange(peak.hour)}, with ${em(plural(peak.sales, "paid sale"))} over ${ctx.input.days} days.` });
  // With few sales, the quietest hour and the day's halves are noise: left out.
  if (enough) {
    const early = percentOf(sum(t.hours.filter((h) => h.hour < 16).map((h) => h.sales)), known);
    points.push({ tone: "info", text: `The quietest open hour was ${hourRange(quiet.hour)}, with ${plural(quiet.sales, "paid sale")}. ${em(`${early}%`)} of paid sales came before 4 PM and ${100 - early}% from 4 PM to closing.` });
  }
  const outside = sum(t.hours.filter((h) => h.hour < OPEN_HOUR || h.hour >= CLOSE_HOUR).map((h) => h.sales));
  if (outside > 0) {
    points.push({ tone: "info", text: `${plural(outside, "sale")} ${outside === 1 ? "was" : "were"} rung up outside opening hours (10 AM to 10 PM): a late cut, or a phone clock that is off.` });
  }
  if (t.hourExcluded > 0) {
    points.push({ tone: "info", text: `${plural(t.hourExcluded, "sale")} with a corrected date ${t.hourExcluded === 1 ? "is" : "are"} left out: the phone's clock was wrong, so the hour is not known.` });
  }
  if (enough && (quiet.hour < from || quiet.hour >= to)) {
    points.push({ tone: "idea", text: `Plan breaks and errands outside ${stretch}; ${hourRange(quiet.hour)} has been the calmest hour for them.` });
  }

  const hoursChart: StoryChart = {
    title: "By hour of the day",
    columns: t.hours.map((h) => ({
      key: String(h.hour),
      axisLabel: shortHour(h.hour),
      label: hourRange(h.hour),
      value: h.sales,
      valueText: plural(h.sales, "paid sale"),
      emphasis: h.hour >= from && h.hour < to,
    })),
    unit: "count",
    summary: `Paid sales by hour of the day over ${ctx.input.days} days. Busiest from ${stretch}, with ${stretchShare}% of them; the single busiest hour was ${hourRange(peak.hour)}.`,
    labelHeading: "Hour",
    valueHeading: "Paid sales",
    labelEvery: 2,
    callout: { key: String(peak.hour), text: `Busiest · ${plural(peak.sales, "sale")}` },
  };
  const highlight: StoryPoint | undefined = enough
    ? { tone: "info", text: `Busiest from ${em(stretch)}, with ${em(`${stretchShare}%`)} of paid sales; the single busiest hour was ${hourRange(peak.hour)}.` }
    : undefined;
  return {
    slide: slide("hours", "When customers come", headline, { points, charts: week ? [week.chart, hoursChart] : [hoursChart] }),
    highlight,
  };
}

// Paid sales an open day for each day of the week. Only for 14 days or more, where most weekdays
// were seen twice; with 7 days the revenue chart already shows each one.
function weekProfile(ctx: Ctx): { chart: StoryChart; point: StoryPoint | null } | null {
  if (ctx.input.days < 14) return null;
  const open = ctx.complete.filter((d) => d.sales > 0);
  const byDay = WEEK.map((weekday) => {
    const days = open.filter((d) => weekdayOf(d.date) === weekday);
    return { weekday, days: days.length, sales: days.length > 0 ? average(days.map((d) => d.sales)) : 0 };
  });
  if (byDay.filter((d) => d.days > 0).length < 4) return null;

  // The busiest and quietest among the weekdays seen at least twice; ties: the earlier in the week.
  const seen = byDay.filter((d) => d.days >= 2);
  const busiest = seen.length >= 2 ? seen.reduce((top, d) => (d.sales > top.sales ? d : top)) : null;
  const quietest = seen.length >= 2 ? seen.reduce((low, d) => (d.sales < low.sales ? d : low)) : null;
  const distinct = busiest !== null && quietest !== null && busiest.sales > quietest.sales;

  let point: StoryPoint | null = null;
  if (distinct) {
    let split = "";
    const weekend = open.filter((d) => isWeekend(d.date));
    const weekday = open.filter((d) => !isWeekend(d.date));
    if (weekend.length >= 2 && weekday.length >= 2) {
      const gap = percentChange(average(weekend.map((d) => d.sales)), average(weekday.map((d) => d.sales)));
      split =
        Math.abs(gap) < NOTABLE
          ? " Weekends and weekdays were about even."
          : ` Weekends averaged ${em(`${Math.abs(gap)}%`)} ${gap > 0 ? "more" : "fewer"} paid sales a day than weekdays.`;
    }
    point = {
      tone: "info",
      text: `${WEEKDAYS[busiest.weekday]}s were the busiest, at ${em(busiest.sales.toFixed(1))} paid sales an open day; ${WEEKDAYS[quietest.weekday]}s the quietest, at ${quietest.sales.toFixed(1)}.${split}`,
    };
  }

  const overall = average(open.map((d) => d.sales));
  const chart: StoryChart = {
    title: "By day of the week",
    columns: byDay.map((d) => ({
      key: `weekday-${d.weekday}`,
      axisLabel: WEEKDAYS[d.weekday].slice(0, 3),
      label: `${WEEKDAYS[d.weekday]}s`,
      value: d.sales,
      valueText: d.days > 0 ? `${d.sales.toFixed(1)} paid sales an open day` : "No open days",
      detail: d.days > 0 ? plural(d.days, "open day") : undefined,
      emphasis: distinct && d.weekday === busiest.weekday,
    })),
    unit: "count",
    summary: `Average paid sales an open day for each day of the week, over ${plural(open.length, "open day")}.${distinct ? ` Busiest on ${WEEKDAYS[busiest.weekday]}s, quietest on ${WEEKDAYS[quietest.weekday]}s.` : ""}`,
    labelHeading: "Day of the week",
    valueHeading: "Paid sales an open day",
    reference: { value: overall, label: `Average ${overall.toFixed(1)}` },
    callout: distinct ? { key: `weekday-${busiest.weekday}`, text: `Busiest · ${busiest.sales.toFixed(1)}` } : undefined,
  };
  return { chart, point };
}

function mixSlide(ctx: Ctx): Built | null {
  const t = ctx.input.trends;
  if (!t || t.sales === 0 || t.byBarber.length === 0) return null;

  const barbers = t.byBarber;
  const [top, second] = barbers;
  const topShare = percentOf(top.revenue, t.revenue);
  let headline: string;
  if (!second) {
    headline = `${top.name} rang up every paid sale in ${ctx.period}: ${em(wholePeso(top.revenue))} from ${plural(top.sales, "sale")}.`;
  } else if (barbers.length === 2 && topShare - (100 - topShare) < STEADY) {
    headline = `Revenue was split almost evenly: ${top.name} ${em(`${topShare}%`)} and ${second.name} ${em(`${100 - topShare}%`)}.`;
  } else {
    headline = `${top.name} brought in ${em(`${topShare}%`)} of revenue: ${em(wholePeso(top.revenue))} from ${plural(top.sales, "paid sale")}.`;
  }

  const points: StoryPoint[] = [];
  const regular = barbers.filter((b) => b.sales >= 3);
  if (regular.length >= 2) points.push({ tone: "info", text: `Average per sale: ${list(regular.map((b) => `${b.name} ${wholePeso(b.revenue / b.sales)}`))}.` });
  if (second) points.push({ tone: "info", text: "Shares follow who was on shift, which the system doesn't record yet, so they aren't a performance score." });

  // The services' shares are printed on their bars, so they get no sentence of their own.
  const itemsSold = sum(t.byService.map((s) => s.sales));
  const digital = t.byMethod.filter((m) => m.digital && m.revenue > 0);
  points.push(
    digital.length === 0
      ? { tone: "info", text: `Every paid sale in ${ctx.period} was paid in cash.` }
      : {
          tone: "info",
          text: `${em(`${percentOf(sum(digital.map((m) => m.revenue)), t.revenue)}%`)} of revenue was paid by ${list(digital.map((m) => m.label))}; that money never enters the drawer.`,
        }
  );
  if (t.tips > 0) {
    points.push({ tone: "info", text: `Customers tipped ${em(peso(t.tips))} on top, about ${percentOf(t.tips, t.revenue)}% of revenue, and all of it goes to the barbers.` });
  }

  const bars = [
    {
      title: "Revenue by barber",
      items: capBars(
        barbers.map((b) => ({ key: b.name, label: b.name, note: plural(b.sales, "sale"), valueText: peso(b.revenue), share: share(b.revenue, t.revenue) })),
        barbers.map((b) => b.revenue),
        (rest) => ({ valueText: peso(rest), share: share(rest, t.revenue) })
      ),
    },
    {
      title: "Services sold",
      items: capBars(
        t.byService.map((s) => ({ key: s.name, label: s.name, valueText: plural(s.sales, "sale"), share: itemsSold > 0 ? share(s.sales, itemsSold) : null })),
        t.byService.map((s) => s.sales),
        (rest) => ({ valueText: plural(rest, "sale"), share: itemsSold > 0 ? share(rest, itemsSold) : null })
      ),
    },
    {
      title: "Payment methods",
      items: t.byMethod.map((m) => ({
        key: m.label,
        label: m.label,
        note: m.digital ? "digital" : "in the drawer",
        valueText: peso(m.revenue),
        share: share(m.revenue, t.revenue),
      })),
    },
  ];
  return {
    slide: slide("mix", "Barbers, services, payments", headline, { points, bars }),
    highlight: second ? { tone: "info", text: headline } : undefined,
  };
}

function forecastSlide(ctx: Ctx): Built {
  const f = ctx.input.forecast;
  const week = "Next 7 days";
  if (!f) return { slide: slide("forecast", week, "The saved forecast can't be loaded right now.") };
  if (!f.run) {
    return {
      slide: slide("forecast", week, "No forecast has been saved yet.", {
        points: [{ tone: "idea", text: "Start the forecast service, open the home page and press Refresh forecast." }],
      }),
    };
  }
  if (f.days.length === 0) {
    return {
      slide: slide("forecast", week, "The saved forecast doesn't cover today yet.", {
        points: [{ tone: "idea", text: "Refresh the forecast on the home page once the forecast service is running." }],
      }),
    };
  }

  const run = f.run;
  const days = f.days;
  const n = days.length;
  const title = `Next ${n} ${n === 1 ? "day" : "days"}`;
  const customers = sum(days.map((d) => d.customers));
  const revenue = sum(days.map((d) => d.revenue));
  // Ties: the earliest day.
  const busiest = days.reduce((top, d) => (d.customers > top.customers ? d : top));
  const quietest = days.reduce((low, d) => (d.customers < low.customers ? d : low));
  // The forecast lost most test weeks to a simple guess: say so wherever its numbers appear.
  const rough = run.weeksWon * 2 < run.weeksTested;
  const about = (value: number) => Math.round(value);

  const headline = `About ${em(String(about(customers)))} customers expected over the next ${n === 1 ? "day" : `${n} days`}, worth around ${em(wholePeso(revenue))}.`;
  const points: StoryPoint[] = [];
  points.push(
    busiest.date === quietest.date
      ? { tone: "info", text: `About ${about(busiest.customers)} customers expected each day.` }
      : {
          tone: "info",
          text: `Busiest ${dayName(busiest.date)} (about ${em(String(about(busiest.customers)))}), quietest ${dayName(quietest.date)} (about ${about(quietest.customers)}).`,
        }
  );
  const recentDays = ctx.complete.filter((d) => d.sales > 0);
  const recent = recentDays.length >= 3 ? sum(recentDays.map((d) => d.sales)) / recentDays.length : null;
  if (recent !== null) {
    const expected = customers / n;
    const gap = Math.round(((expected - recent) / recent) * 100);
    const recentText = `the ${recent.toFixed(1)} paid sales an open day in ${ctx.period}`;
    points.push(
      Math.abs(gap) < NOTABLE
        ? { tone: "flat", text: `About ${expected.toFixed(1)} customers a day, in line with ${recentText}.` }
        : {
            tone: gap > 0 ? "up" : "down",
            text: `About ${expected.toFixed(1)} customers a day, ${em(`${Math.abs(gap)}%`)} ${gap > 0 ? "above" : "below"} ${recentText} (one paid sale is roughly one customer).`,
          }
    );
  }
  points.push({
    tone: rough ? "warn" : "info",
    text: `On ${plural(run.weeksTested, "past test week")} it was off by about ${em(run.typicalError.toFixed(1))} customers a day (about ${wholePeso(run.typicalError * run.avgTicket)}) and beat the best simple guess, ${run.bestBaseline.toLowerCase()}, in ${run.weeksWon} of ${run.weeksTested}.${rough ? " Treat it as a rough guide." : ""}`,
  });
  if (n < 7) points.push({ tone: "idea", text: `The saved forecast runs out after ${n === 1 ? "today" : `${n} days`}. Refresh it on the home page to see a full week.` });

  const figures: StoryFigure[] = [
    { label: "Expected customers", value: String(about(customers)), note: `About ${(customers / n).toFixed(1)} a day` },
    { label: "Expected revenue", value: wholePeso(revenue), note: `${peso(run.avgTicket)} per customer` },
    { label: "Busiest day", value: formatDate(busiest.date, { weekday: "short" }), note: `About ${about(busiest.customers)} customers` },
    { label: "Forecast off by", value: run.typicalError.toFixed(2), note: "Customers a day, on test weeks" },
  ];
  const values = days.map((d) => d.customers);
  const chart: StoryChart = {
    title: "Expected customers per day",
    columns: days.map((d) => ({
      key: d.date,
      axisLabel: formatDate(d.date, { weekday: "short" }),
      label: dayName(d.date),
      value: d.customers,
      valueText: `${d.customers.toFixed(1)} customers`,
      detail: `${peso(d.revenue)} expected revenue`,
      emphasis: d.date === busiest.date,
    })),
    unit: "count",
    summary: `Expected customers for the next ${n} days, from ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)} a day. Busiest ${dayName(busiest.date)}.${recent !== null ? ` Recently ${recent.toFixed(1)} paid sales an open day.` : ""}`,
    labelHeading: "Day",
    valueHeading: "Expected customers",
    // What the shop has actually been doing, to read the forecast against.
    reference: recent !== null ? { value: recent, label: `Recent: ${recent.toFixed(1)} sales a day` } : undefined,
    callout: { key: busiest.date, text: `Busiest · about ${about(busiest.customers)}` },
  };
  const footnote = `Expected revenue = expected customers × ${peso(run.avgTicket)}, the average paid per customer in the paper logbook the model learned from, not today's prices. Forecast saved ${shortDate(run.createdOn)}.`;
  return {
    slide: slide("forecast", title, headline, { figures, points, charts: [chart], footnote }),
    highlight: { tone: "info", text: `${title}: about ${em(String(about(customers)))} customers and ${em(wholePeso(revenue))} expected${rough ? " (a rough guide)" : ""}.` },
  };
}

function todoSlide(ctx: Ctx): Built {
  const { day, trends: t, forecast, date } = ctx.input;
  const items: StoryTodo[] = [];
  const checks: StoryPoint[] = [];
  const endOfDay = { href: "/reconciliation", label: "End-of-Day Cash" };
  const ledger = { href: "/ledger", label: "Barber Ledger" };
  const on = ctx.isToday ? "today" : `on ${shortDate(date)}`;

  const dayHeld = day?.heldForReview ?? 0;
  const periodHeld = t?.heldForReview ?? 0;
  if (dayHeld > 0) {
    items.push({ text: `Confirm the date of ${em(plural(dayHeld, "sale"))} stamped ${on}: ${dayHeld === 1 ? "it is" : "they are"} held for review and left out of the figures.`, link: endOfDay });
  }
  if (periodHeld > dayHeld) {
    const more = periodHeld - dayHeld;
    items.push({ text: `${em(plural(more, dayHeld > 0 ? "more sale" : "sale"))} elsewhere in ${ctx.period} ${more === 1 ? "is" : "are"} held for a date review.`, link: endOfDay });
  }
  if (day && t && periodHeld === 0 && dayHeld === 0) checks.push({ tone: "good", text: "No sales are waiting for a date review." });

  if (day) {
    if (day.pendingQrph > 0) {
      const one = day.pendingQrph === 1;
      items.push({ text: `${em(plural(day.pendingQrph, "QR Ph sale"))} ${on} ${one ? "is" : "are"} not confirmed paid yet, so ${one ? "it is" : "they are"} left out of revenue. Check ${one ? "its" : "their"} status on the shift log.` });
    }

    const drawer = day.drawer;
    if (drawer?.stale) {
      items.push({ text: "Count the drawer again: sales changed after the saved count, so it no longer matches the register.", link: endOfDay });
    } else if (drawer && drawer.status !== "balanced") {
      items.push({ text: `Look into the drawer: it was ${em(peso(Math.abs(drawer.variance)))} ${drawer.status} when it was counted.`, link: endOfDay });
    } else if (drawer) {
      checks.push({ tone: "good", text: "The drawer count balanced." });
    } else if (!ctx.inProgress && day.sales > 0) {
      items.push({ text: `Count the drawer for ${shortDate(date)}: no count was saved.`, link: endOfDay });
    }

    for (const barber of day.barbers.filter((b) => b.additionalOwed)) {
      items.push({ text: `Pay ${barber.name} the extra ${em(peso(barber.remaining))}: sales were counted after the payout was marked paid.`, link: ledger });
    }
    const unpaid = day.barbers.filter((b) => b.remaining > 0 && !b.additionalOwed);
    if (unpaid.length > 0) {
      items.push({
        text: ctx.inProgress
          ? `Before each barber goes home, pay out what they've earned: ${list(unpaid.map((b) => `${b.name} ${em(peso(b.remaining))} so far`))}.`
          : `Pay out ${list(unpaid.map((b) => `${b.name} ${em(peso(b.remaining))}`))}.`,
        link: ledger,
      });
    } else if (!day.barbers.some((b) => b.additionalOwed) && day.barbers.some((b) => b.earned > 0)) {
      checks.push({ tone: "good", text: "Every barber's earnings are paid out." });
    }
  }

  if (t && t.sales > 0) {
    const { start, gaps } = quietDays(ctx);
    if (gaps.length > 0) {
      items.push({ text: `Check ${someDates(gaps)}: no paid sales were recorded on ${gaps.length === 1 ? "that day" : "those days"}, though the shop opens daily.` });
    } else {
      checks.push({ tone: "good", text: start ? `Paid sales were recorded every day since ${shortDate(start)}.` : `Paid sales were recorded on every day of ${ctx.period}.` });
    }
  }

  if (forecast && (!forecast.run || forecast.days.length < 7)) {
    items.push({
      text: forecast.run ? "Refresh the forecast: the saved one doesn't cover the whole week ahead." : "Make the first forecast: start the forecast service and press Refresh forecast.",
      link: { href: "/", label: "Home" },
    });
  }

  if (!day || !t) checks.push({ tone: "warn", text: "Some figures couldn't be loaded, so this list may be incomplete." });

  const scope = ctx.isToday ? "today" : `for ${shortDate(date)}`;
  const needs = items.length === 1 ? "One thing needs" : `${em(String(items.length))} things need`;
  const headline = items.length === 0 ? (day && t ? `Nothing needs attention ${scope}.` : "Nothing to flag in the figures that loaded.") : `${needs} attention.`;
  return {
    slide: slide("todo", items.length === 0 ? "All clear" : "Needs attention", headline, { points: checks, todo: items }),
    highlight:
      items.length === 0
        ? { tone: "good", text: `Nothing needs attention ${scope}.` }
        : { tone: "warn", text: `${items.length === 1 ? "One thing" : `${em(String(items.length))} things`} to look at: see the last slide.` },
  };
}

// Today's pace while the shop is open. By this hour, the period's other days had made a known
// share of their paid sales, so today's revenue so far ÷ that share is where today could end.
// Today's sales so far sit in the hours up to now, so they come off both sides of the share.
// Rough by nature: only with enough history, two hours after opening, and rounded to ₱50.
function pace(ctx: Ctx): { projected: number; share: number; hour: number } | null {
  const { day, trends: t, manilaHour } = ctx.input;
  if (!ctx.inProgress || !day || !t || day.sales === 0 || manilaHour < OPEN_HOUR + 2) return null;
  const known = sum(t.hours.map((h) => h.sales));
  const before = sum(t.hours.filter((h) => h.hour < manilaHour).map((h) => h.sales)) - day.sales;
  const total = known - day.sales;
  if (total < PACE_SALES || before <= 0) return null;
  const share = before / total;
  if (share < 0.2 || share > 0.9) return null;
  return { projected: Math.round(day.revenue / share / 50) * 50, share, hour: manilaHour };
}

// The period's later days against its earlier ones, per calendar day: is the shop picking up or
// slowing down? Only for 14 days or more, without today while it is still open.
function momentum(ctx: Ctx): StoryPoint | null {
  if (ctx.input.days < 14 || ctx.complete.length < 6) return null;
  const half = Math.floor(ctx.complete.length / 2);
  const early = ctx.complete.slice(0, ctx.complete.length - half); // an odd day goes to the earlier half
  const late = ctx.complete.slice(ctx.complete.length - half);
  const earlyAverage = average(early.map((d) => d.revenue));
  const lateAverage = average(late.map((d) => d.revenue));
  if (earlyAverage <= 0) return null;
  const change = percentChange(lateAverage, earlyAverage);
  const later = `the later ${late.length} days averaged ${em(wholePeso(lateAverage))} a day`;
  if (Math.abs(change) < NOTABLE) return { tone: "flat", text: `Steady through the period: ${later}, about the same as the first ${early.length}.` };
  return {
    tone: change > 0 ? "up" : "down",
    text: `${change > 0 ? "Picking up" : "Slowing down"}: ${later}, ${em(`${Math.abs(change)}%`)} ${change > 0 ? "more" : "less"} than the first ${early.length}.`,
  };
}

// Days in the period with no paid sales. When the days before the period had none either, the
// days before its first sale are most likely before the POS was in use: those are reported as
// the start, not as gaps. Today is left out while the shop is still open.
function quietDays(ctx: Ctx): { start: string | null; gaps: string[] } {
  const t = ctx.input.trends;
  if (!t || t.sales === 0) return { start: null, gaps: [] };
  const firstSale = t.daily.find((d) => d.sales > 0)?.date ?? t.first;
  const fresh = t.previous.sales === 0;
  return {
    start: fresh && firstSale > t.first ? firstSale : null,
    gaps: ctx.complete.filter((d) => d.sales === 0 && (!fresh || d.date > firstSale)).map((d) => d.date),
  };
}

function forecastTotals(forecast: StoryForecast | null) {
  if (!forecast?.run || forecast.days.length === 0) return null;
  return {
    days: forecast.days.length,
    customers: sum(forecast.days.map((d) => d.customers)),
    revenue: sum(forecast.days.map((d) => d.revenue)),
  };
}

// Up to MAX_BARS bars: past that, the first MAX_BARS - 1 and the rest summed as "Others".
// `values` holds each item's amount, in the same order.
function capBars(items: BarItem[], values: number[], rest: (total: number) => Pick<BarItem, "valueText" | "share">): BarItem[] {
  if (items.length <= MAX_BARS) return items;
  const others = sum(values.slice(MAX_BARS - 1));
  return [...items.slice(0, MAX_BARS - 1), { key: "others", label: "Others", note: `${items.length - MAX_BARS + 1} more`, ...rest(others) }];
}

// ── Wording helpers ──────────────────────────────────────────────────────────

// ", up **17%** on the 14 days before"
function versus(current: number, previous: number, before: string) {
  if (cents(previous) <= 0) return `; ${before} had none to compare with`;
  const change = percentChange(current, previous);
  if (Math.abs(change) < STEADY) return `, about the same as ${before}`;
  return `, ${change > 0 ? "up" : "down"} ${em(`${Math.abs(change)}%`)} on ${before}`;
}

// The same words and rounding as the Insights page's figure deltas.
function delta(current: number, previous: number, days: number): StoryDelta {
  const before = `the ${days} days before`;
  if (cents(previous) === 0) return cents(current) === 0 ? { text: `Same as ${before}`, trend: "flat" } : { text: `Up from nothing in ${before}`, trend: "up" };
  const percent = percentChange(current, previous);
  if (percent === 0) return { text: `About the same as ${before}`, trend: "flat" };
  return { text: `${percent > 0 ? "+" : "−"}${Math.abs(percent)}% vs ${before}`, trend: percent > 0 ? "up" : "down" };
}

// Whole-percent change. Worked in centavos (whole numbers), so peso amounts round exactly as the
// page's Decimal arithmetic does.
function percentChange(current: number, previous: number) {
  const before = cents(previous);
  return Math.round(((cents(current) - before) * 100) / before);
}

function cents(value: number) {
  return Math.round(value * 100);
}

// Whole percent of the whole, 0 when there is nothing to divide.
function percentOf(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// Percent to one decimal, or null, as the page's bars take it.
function share(part: number, whole: number) {
  return whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : null;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length > 0 ? sum(values) / values.length : 0;
}

const pesoFormat = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ₱1,234.50; a negative amount as −₱1,234.50.
export function peso(value: number) {
  const amount = Math.round(Math.abs(value) * 100);
  return `${value < 0 && amount > 0 ? "−" : ""}₱${pesoFormat.format(amount / 100)}`;
}

function wholePeso(value: number) {
  return `₱${Math.round(value).toLocaleString("en-PH")}`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// "**82** paid sales"
function countOf(count: number, word: string) {
  return `${em(String(count))} ${word}${count === 1 ? "" : "s"}`;
}

// "a", "a and b", "a, b and c"
function list(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Up to three dates, then "and 4 more".
function someDates(dates: string[]) {
  const shown = dates.slice(0, 3).map(dayName);
  return dates.length > 3 ? `${shown.join(", ")} and ${dates.length - 3} more` : list(shown);
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function isWeekend(date: string) {
  const weekday = weekdayOf(date);
  return weekday === 0 || weekday === 6;
}

// Business dates are YYYY-MM-DD calendar dates: format them as dates, not as instants.
function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function shortDate(date: string) {
  return formatDate(date, { month: "short", day: "numeric" });
}

function dayName(date: string) {
  return formatDate(date, { weekday: "short", month: "short", day: "numeric" });
}

const meridiem = (hour: number) => (hour % 24 < 12 ? "AM" : "PM");
const clock = (hour: number) => `${hour % 12 || 12}`;

// "3 PM"
function clockHour(hour: number) {
  return `${clock(hour)} ${meridiem(hour)}`;
}

// "2 to 5 PM", "11 AM to 2 PM"; with "–" as the joiner, "2–5 PM".
function hourSpan(from: number, to: number, joiner = " to ") {
  return meridiem(from) === meridiem(to)
    ? `${clock(from)}${joiner}${clock(to)} ${meridiem(to)}`
    : `${clock(from)} ${meridiem(from)}${joiner}${clock(to)} ${meridiem(to)}`;
}

// "2–3 PM", as on the page.
function hourRange(hour: number) {
  return hourSpan(hour, hour + 1, "–");
}

function shortHour(hour: number) {
  return `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
}
