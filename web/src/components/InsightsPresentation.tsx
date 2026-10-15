"use client";

// Presentation mode on /insights: the owner's summary as full-screen slides, one finding per
// slide. The words and figures are written on the server from the page's own numbers
// (src/lib/insights-story.ts); this only shows them. Read-only, like the page.
//
// Motion (DESIGN.md, Presentation):
// - Lights on: the first time it opens in a session, the LED tube over the hung logo sign
//   flickers alive, the room's light comes up and "Insights" is lettered in. Any key or tap skips it.
// - Register wheels: each key figure rolls into place digit by digit, like a cash register's
//   number wheels, then settles into plain text.
// - The deck: slides move the way the owner goes; a title rises from behind its baseline and its
//   sentence comes into focus word by word, its key figures landing in brass.
// Reduced motion keeps every word and figure and drops the movement: no intro, no wheels, fades.
// Keys: arrows, Page Up/Down, Space, Home/End move; P plays or pauses; F full screen; Esc closes.
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Lightbulb,
  Maximize,
  Minimize,
  Minus,
  Pause,
  Play,
  Presentation,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { BarList } from "@/components/BarList";
import { ColumnChart } from "@/components/ColumnChart";
import { BarberPoleIcon, MustacheIcon, RuzzcoLogoBanner } from "@/components/RuzzcoBrand";
import { emphasisRuns, plain, type Story, type StoryChart, type StoryFigure, type StoryPoint, type StorySlide, type Tone } from "@/lib/insights-story";

// When each part of a slide starts, in ms after the slide arrives: the title, then its sentence,
// then the figures and charts the sentence is about, then the notes under them.
const TITLE_AT = 60;
const HEADLINE_AT = 180;
const FIGURES_AT = 420;
const CHARTS_AT = 480;
const NOTES_AT = 620;
const WORD_STEP = 26; // between headline words...
const WORD_CAP = 520; // ...up to this, so a long sentence never makes anyone wait
const WHEEL_STEP = 45; // between the wheels of one figure, left to right
const EXIT_MS = 260; // a slide leaves faster than the next one arrives (460 ms)
const INTRO_KEY = "rz-insights-intro"; // sessionStorage: the intro has played in this session
const INTRO_HOLD_MS = 1850; // lights on and title set: the intro lifts
const INTRO_OUT_MS = 420;
const AFTER_INTRO = 300; // the first slide waits until most of the intro has lifted
const REDUCED = "(prefers-reduced-motion: reduce)";
// Two turns of a register wheel: a digit rolls from its place on the first turn to the second.
const STRIP = "0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n0\n1\n2\n3\n4\n5\n6\n7\n8\n9";

type Phase = "intro" | "leaving" | "deck";
type Run = { text: string; em: boolean };

export function InsightsPresentation({ story }: { story: Story }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Back on the page, focus returns to the button. This runs after the stage's cleanup has made
  // the page usable again, so the button can take it.
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="rz-btn rz-btn-primary shrink-0 px-4 pointer-coarse:min-h-11"
      >
        <Presentation className="w-4 h-4" />
        Present summary
      </button>
      {open &&
        createPortal(
          <Stage
            story={story}
            onClose={() => {
              returnFocus.current = true;
              setOpen(false);
            }}
          />,
          document.body
        )}
    </>
  );
}

function Stage({ story, onClose }: { story: Story; onClose: () => void }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(() => (playsIntro() ? "intro" : "deck"));
  // The slide shown, the one leaving (kept for its exit), and which way the deck moved.
  const [view, setView] = useState<{ index: number; from: number | null; dir: 1 | -1 }>({ index: 0, from: null, dir: 1 });
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const titleId = useId();
  const count = story.slides.length;
  const current = Math.min(view.index, count - 1);
  const slide = story.slides[current];
  const last = current === count - 1;
  const leaving = view.from !== null && view.from !== current && view.from < count ? view.from : null;
  const deck = phase !== "intro";
  // The stage only renders in the browser (it opens on a click), so `document` is there.
  const canFullscreen = document.fullscreenEnabled;

  const moveTo = useCallback(
    (pick: (index: number) => number) =>
      setView((v) => {
        const target = Math.min(count - 1, Math.max(0, pick(v.index)));
        return target === v.index ? v : { index: target, from: v.index, dir: target > v.index ? 1 : -1 };
      }),
    [count]
  );
  const step = useCallback((by: number) => moveTo((i) => i + by), [moveTo]);
  const skipIntro = useCallback(() => setPhase((p) => (p === "intro" ? "leaving" : p)), []);

  // Play from the start when it is pressed on the last slide.
  const togglePlay = useCallback(() => {
    if (!playing && last) moveTo(() => 0);
    setPlaying(!playing);
  }, [playing, last, moveTo]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void stage.current?.requestFullscreen().catch(() => {});
  }, []);

  // While open, the page behind is inert (no focus, no clicks, nothing read out) and does not
  // scroll. Closing, or leaving through a link, undoes both and leaves full screen.
  useEffect(() => {
    const root = stage.current!;
    const page = [...document.body.children].filter((element) => element !== root && !element.hasAttribute("inert"));
    for (const element of page) element.setAttribute("inert", "");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.focus();
    return () => {
      for (const element of page) element.removeAttribute("inert");
      document.body.style.overflow = overflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Autoplay stops when the page is hidden: nothing advances unseen.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // The intro holds while the lights come on, then lifts away over the deck.
  useEffect(() => {
    if (phase === "deck") return;
    if (phase === "intro") markIntroPlayed();
    const timer = window.setTimeout(() => setPhase(phase === "intro" ? "leaving" : "deck"), phase === "intro" ? INTRO_HOLD_MS : INTRO_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // The leaving slide is dropped once its exit has played.
  useEffect(() => {
    if (view.from === null) return;
    const timer = window.setTimeout(() => setView((v) => ({ ...v, from: null })), EXIT_MS + 40);
    return () => window.clearTimeout(timer);
  }, [view]);

  // Each slide starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [current]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // During the intro any key skips it (Esc closes), except bare modifiers and Tab.
      if (phase === "intro") {
        if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Escape") onClose();
        else skipIntro();
        return;
      }
      // A focused chart reads its own columns with the arrow keys and Home/End, and marks them handled.
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const onControl = event.target instanceof Element && event.target.closest("a, button, summary") !== null;
      switch (event.key) {
        case "ArrowRight":
        case "PageDown":
          step(1);
          break;
        case "ArrowLeft":
        case "PageUp":
          step(-1);
          break;
        case " ":
          // Space presses a focused button or link instead.
          if (onControl) return;
          step(event.shiftKey ? -1 : 1);
          break;
        case "Home":
          moveTo(() => 0);
          break;
        case "End":
          moveTo(() => count - 1);
          break;
        case "p":
        case "P":
          togglePlay();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          onClose();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, count, onClose, step, moveTo, skipIntro, togglePlay, toggleFullscreen]);

  // A sideways swipe moves a slide; a swipe that starts on a chart reads the chart instead.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const onChart = event.target instanceof Element && event.target.closest('[aria-roledescription="chart"]') !== null;
    swipe.current = event.pointerType === "mouse" || onChart ? null : { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  };

  // 36px controls, 44px on touch screens.
  const iconButton = "rz-btn rz-btn-ghost rz-btn-icon pointer-coarse:min-h-11 pointer-coarse:min-w-11";
  const layers = leaving === null ? [current] : [leaving, current];

  return (
    <div
      ref={stage}
      role="dialog"
      aria-modal="true"
      aria-label="Insights summary"
      tabIndex={-1}
      className="rz-stage fixed inset-0 z-50 flex flex-col overflow-hidden outline-none"
    >
      {deck && (
        // The banners come in from the top and bottom edges, like a film's letterbox.
        <div className="rz-letterbox-top relative z-10 shrink-0">
          <div aria-hidden="true" className="rz-ribbon" />
          <header className="rz-banner">
            <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 sm:px-8 py-2.5">
              <p className="flex items-center gap-2 shrink-0 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
                {/* The station light: it turns while the slides play themselves. */}
                <BarberPoleIcon className="w-2.5 h-6" spinning={playing} />
                Insights
              </p>
              <p className="hidden sm:block min-w-0 truncate text-sm text-dust">{story.dateLine}</p>
              <p className="hidden lg:flex pointer-coarse:hidden items-center gap-1.5 ml-auto shrink-0 text-xs text-dust">
                <Key>
                  <ArrowLeft aria-hidden="true" className="w-3 h-3" />
                  <span className="sr-only">Left arrow</span>
                </Key>
                <Key>
                  <ArrowRight aria-hidden="true" className="w-3 h-3" />
                  <span className="sr-only">Right arrow</span>
                </Key>
                move · <Key>P</Key> play · <Key>F</Key> full screen · <Key>Esc</Key> close
              </p>
              <div className="flex items-center gap-1 ml-auto lg:ml-0 shrink-0">
                {canFullscreen && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                    title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
                    className={iconButton}
                  >
                    {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                  </button>
                )}
                <button type="button" onClick={onClose} aria-label="Close presentation" title="Close (Esc)" className={iconButton}>
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </header>
        </div>
      )}

      <div
        ref={scroller}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        // Vertical scrolling and zoom stay the browser's; sideways moves are the swipe.
        style={{ touchAction: "pan-y pinch-zoom" }}
        className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        {deck && (
          // Both slides share one grid cell while one leaves and the next arrives.
          <div className="grid">
            {layers.map((index) => {
              const out = index === leaving;
              return (
                <Layer key={story.slides[index].id} out={out} dir={view.dir} start={phase === "leaving" ? AFTER_INTRO : 0}>
                  <SlideView slide={story.slides[index]} titleId={out ? undefined : titleId} reduced={reduced} start={phase === "leaving" ? AFTER_INTRO : 0} />
                </Layer>
              );
            })}
          </div>
        )}
      </div>

      {deck && (
        <footer className="rz-stage-foot rz-letterbox-bottom relative z-10 shrink-0">
          {playing && (
            // Autoplay's timer: a hairline along the top of the foot, filling once per slide.
            <span
              key={current}
              aria-hidden="true"
              className="rz-timer absolute inset-x-0 top-0 h-0.5 bg-bone/80"
              style={{ animationDuration: `${readingTime(slide)}ms` }}
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                if (last) setPlaying(false);
                else step(1);
              }}
            />
          )}
          <div className="max-w-5xl mx-auto flex items-center gap-2 sm:gap-4 px-4 sm:px-8 py-3">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={current === 0}
              aria-label="Previous slide"
              className="rz-btn rz-btn-secondary px-3 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause slides" : "Play slides"}
              title={playing ? "Pause (P)" : "Play (P)"}
              className={iconButton}
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <ol aria-label="Slides" className="hidden sm:flex flex-1 items-center gap-1.5">
              {story.slides.map((item, i) => (
                <li key={item.id} className="flex-1">
                  <button
                    type="button"
                    onClick={() => moveTo(() => i)}
                    aria-label={`Slide ${i + 1}: ${item.title}`}
                    aria-current={i === current ? "step" : undefined}
                    title={item.title}
                    className="group flex w-full items-center py-3 rounded-sm pointer-coarse:min-h-11"
                  >
                    <span
                      className={`h-1 w-full rounded-full transition-colors duration-200 ${
                        i === current ? "bg-bone" : i < current ? "bg-bone-2/45 group-hover:bg-bone-2/70" : "bg-seam-strong group-hover:bg-seam-hover"
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ol>
            <p aria-hidden="true" className="flex-1 sm:flex-none text-center text-sm text-dust tabular-nums">
              {current + 1} / {count}
            </p>
            <button type="button" onClick={last ? onClose : () => step(1)} className="rz-btn rz-btn-primary px-4 pointer-coarse:min-h-11">
              {last ? "Done" : "Next"}
              {!last && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </footer>
      )}

      {phase !== "deck" && <Intro phase={phase} dateLine={story.dateLine} onSkip={skipIntro} />}

      <p aria-live="polite" className="sr-only">
        {deck ? `Slide ${current + 1} of ${count}: ${slide.title}` : ""}
      </p>
    </div>
  );
}

// One slide in the deck's grid cell: arriving from the way the deck moved, or leaving the other
// way. `start` holds the arrival back; it is read once, when the slide first arrives.
function Layer({ out, dir, start, children }: { out: boolean; dir: 1 | -1; start: number; children: ReactNode }) {
  const [delay] = useState(start);
  return (
    <div
      inert={out || undefined}
      aria-hidden={out || undefined}
      className={`[grid-area:1/1] min-w-0 ${out ? "rz-slide-out pointer-events-none" : "rz-slide-in"}`}
      style={{ "--dir": dir, animationDelay: out ? undefined : `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

// The shop switching on: the LED tube over the hung sign flickers alive, the room's light comes
// up, "Insights" is lettered in under the brass mustache. Decorative, so hidden from screen readers.
function Intro({ phase, dateLine, onSkip }: { phase: Phase; dateLine: string; onSkip: () => void }) {
  return (
    <div aria-hidden="true" data-phase={phase} onPointerDown={onSkip} className="rz-intro">
      <div className="rz-intro-dark" />
      <div className="rz-intro-set w-60 sm:w-88">
        <span className="rz-intro-tube" />
        <div className="rz-intro-sign w-full">
          <RuzzcoLogoBanner className="w-full" alt="" sizes="(min-width: 640px) 22rem, 15rem" />
        </div>
        <p className="rz-intro-title rz-title text-[2.75rem] sm:text-6xl">Insights</p>
        <div className="rz-ornament rz-intro-ornament w-full">
          <MustacheIcon className="w-9 h-3.5" />
        </div>
        {/* Breaks only at the separator, never inside "14-day". */}
        <p className="rz-intro-date text-sm sm:text-base text-bone-2">
          {dateLine.split(" · ").map((part, i) => (
            <Fragment key={part}>
              {i > 0 && " · "}
              <span className="whitespace-nowrap">{part}</span>
            </Fragment>
          ))}
        </p>
      </div>
    </div>
  );
}

// `start` holds the whole entrance back (after the intro); it is read once, when the slide arrives.
function SlideView({ slide, titleId, reduced, start }: { slide: StorySlide; titleId?: string; reduced: boolean; start: number }) {
  const [offset] = useState(start);
  const charts = slide.charts ?? [];
  const figures = slide.figures.length;
  const notes = (wide: boolean) => (slide.points.length > 0 ? <Notes points={slide.points} delay={offset + NOTES_AT} wide={wide} /> : null);
  return (
    <section aria-roledescription="slide" aria-labelledby={titleId} className="max-w-5xl mx-auto px-4 sm:px-8 pt-7 pb-10 sm:pt-9 space-y-6">
      <header className="space-y-3">
        <h2 id={titleId} className="rz-title text-4xl sm:text-5xl">
          {/* The title rises from behind its own baseline. */}
          <span className="rz-rise-line">
            <span style={{ animationDelay: `${offset + TITLE_AT}ms` }}>{slide.title}</span>
          </span>
        </h2>
        <Headline text={slide.headline} reduced={reduced} start={offset + HEADLINE_AT} />
      </header>

      {figures > 0 && (
        <div
          className={`rz-strip rz-stagger ${figures === 3 ? "grid-cols-1 sm:grid-cols-3" : figures === 1 ? "grid-cols-1" : `grid-cols-2 ${figures >= 4 ? "lg:grid-cols-4" : ""}`}`}
        >
          {slide.figures.map((figure, i) => (
            <Figure key={figure.label} figure={figure} delay={offset + FIGURES_AT + i * 90} reduced={reduced} />
          ))}
        </div>
      )}

      {charts.length === 1 ? (
        // One chart and what it says, side by side on wide screens; a long run of columns gets
        // the wider share.
        <div className={`grid grid-cols-1 gap-5 items-start ${charts[0].columns.length > 8 ? "lg:grid-cols-[3fr_2fr]" : "lg:grid-cols-2"}`}>
          <ChartPanel chart={charts[0]} height={176} delay={offset + CHARTS_AT} />
          {notes(false)}
        </div>
      ) : charts.length > 1 ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {charts.map((chart) => (
              <ChartPanel key={chart.title} chart={chart} height={150} delay={offset + CHARTS_AT} />
            ))}
          </div>
          {notes(true)}
        </>
      ) : (
        <>
          {slide.bars && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {slide.bars.map((group) => (
                <Panel key={group.title} title={group.title}>
                  <BarList items={group.items} delay={offset + CHARTS_AT} />
                </Panel>
              ))}
            </div>
          )}
          {slide.todo && slide.todo.length > 0 && (
            <ul className="rz-panel rz-rows rz-stagger max-w-3xl">
              {slide.todo.map((item) => (
                <li key={item.text} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 sm:px-5 py-3.5">
                  <AlertTriangle aria-hidden="true" className="w-5 h-5 mt-1 shrink-0 text-warn-ink" />
                  <p className="flex-1 min-w-48 text-base sm:text-[1.0625rem] leading-relaxed text-bone">
                    <Rich text={item.text} />
                  </p>
                  {item.link && (
                    <Link
                      href={item.link.href}
                      className="rz-btn rz-btn-secondary shrink-0 min-h-9 ml-8 sm:ml-0 px-3 pointer-coarse:min-h-11"
                    >
                      {item.link.label}
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {notes(false)}
        </>
      )}

      {slide.footnote && <p className="max-w-3xl text-xs sm:text-sm text-dust leading-relaxed">{slide.footnote}</p>}
    </section>
  );
}

// The slide's sentence, word by word into focus. Its marked figures roll in on register wheels.
function Headline({ text, reduced, start }: { text: string; reduced: boolean; start: number }) {
  return (
    <p className="max-w-[42ch] text-xl sm:text-2xl leading-snug [--wheel-lh:1.375em] text-bone text-pretty">
      {splitWords(text).map((word, i) => {
        const at = start + Math.min(i * WORD_STEP, WORD_CAP);
        return (
          <Fragment key={i}>
            {i > 0 && " "}
            <span className="rz-word" style={{ animationDelay: `${at}ms` }}>
              {word.map((run, j) => (run.em ? <Em key={j} text={run.text} at={at + 120} reduced={reduced} /> : <Fragment key={j}>{run.text}</Fragment>))}
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}

// A key figure in a sentence, in the figures' face. Money lands in brass and stays brass; any
// other figure rolls in brass and settles to bone, as a changed checkout amount does.
function Em({ text, at, reduced }: { text: string; at: number; reduced: boolean }) {
  const money = /^[−-]?₱/.test(text);
  return (
    <span className={`rz-em ${money ? "text-brass-bright" : "rz-em-settle"}`} style={money ? undefined : { animationDelay: `${at + 860}ms` }}>
      <Rolling text={text} delay={at} reduced={reduced} />
    </span>
  );
}

// A figure on register wheels: each digit rolls one full turn into place, left to right, while
// the other characters (₱ , . % –) stand still. Read out as plain text; plain text once landed.
function Rolling({ text, delay, reduced }: { text: string; delay: number; reduced: boolean }) {
  const [landed, setLanded] = useState(false);
  const chars = Array.from(text);
  const digits = chars.filter(isDigit).length;
  if (reduced || landed || digits === 0) return <>{text}</>;
  let order = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {chars.map((char, i) => {
          if (!isDigit(char)) return <Fragment key={i}>{char}</Fragment>;
          const wheel = order++;
          return (
            <span key={i} className="rz-wheel">
              <span className="rz-wheel-face">{char}</span>
              <span
                className="rz-wheel-strip"
                style={{ "--to": char, animationDelay: `${delay + wheel * WHEEL_STEP}ms` } as CSSProperties}
                onAnimationEnd={wheel === digits - 1 ? () => setLanded(true) : undefined}
              >
                {STRIP}
              </span>
            </span>
          );
        })}
      </span>
    </>
  );
}

function Figure({ figure, delay, reduced }: { figure: StoryFigure; delay: number; reduced: boolean }) {
  const trend = figure.delta?.trend;
  return (
    <div className="space-y-1.5 px-4 py-4 sm:px-5 sm:py-5">
      <div className="rz-label">{figure.label}</div>
      <div className={`rz-figure text-[1.75rem] sm:text-4xl [--wheel-lh:1.1em] ${figure.money ? "text-brass-bright" : "text-bone"}`}>
        <Rolling text={figure.value} delay={delay} reduced={reduced} />
      </div>
      {figure.note && <p className="text-xs sm:text-sm text-dust leading-relaxed">{figure.note}</p>}
      {/* Up is good for every figure that has a delta here: icon and words, not colour alone. */}
      {figure.delta && (
        <p
          className={`flex items-start gap-1 text-xs sm:text-sm ${trend === "up" ? "text-ok-ink" : trend === "down" ? "text-crimson-ink" : "text-dust"}`}
          style={{ animation: `rz-fade 400ms ease-out ${delay + 640}ms both` }}
        >
          {trend === "up" ? (
            <TrendingUp aria-hidden="true" className="w-4 h-4 mt-px shrink-0" />
          ) : trend === "down" ? (
            <TrendingDown aria-hidden="true" className="w-4 h-4 mt-px shrink-0" />
          ) : (
            <Minus aria-hidden="true" className="w-4 h-4 mt-px shrink-0" />
          )}
          {figure.delta.text}
        </p>
      )}
    </div>
  );
}

// Each point's icon says what kind of finding it is; the words carry it too, and warnings are
// named for screen readers. Suggestions sit apart, under the facts.
const TONES: Record<Exclude<Tone, "info" | "idea">, { icon: LucideIcon; className: string; spoken?: string }> = {
  up: { icon: TrendingUp, className: "text-ok-ink" },
  down: { icon: TrendingDown, className: "text-crimson-ink" },
  flat: { icon: Minus, className: "text-dust" },
  good: { icon: CircleCheck, className: "text-ok-ink" },
  warn: { icon: AlertTriangle, className: "text-warn-ink", spoken: "Needs attention: " },
};

// `wide`: under a pair of charts, the facts and the suggestion sit side by side on wide screens.
function Notes({ points, delay, wide }: { points: StoryPoint[]; delay: number; wide: boolean }) {
  const facts = points.filter((point) => point.tone !== "idea");
  const ideas = points.filter((point) => point.tone === "idea");
  return (
    <div
      className={`rz-notes ${wide && ideas.length > 0 && facts.length > 0 ? "grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 lg:gap-5 items-start" : "max-w-3xl space-y-3"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {facts.length > 0 && (
        <ul className="rz-panel rz-rows">
          {facts.map((point) => {
            const tone = point.tone === "info" || point.tone === "idea" ? null : TONES[point.tone];
            return (
              <li key={point.text} className="flex items-start gap-3 px-4 sm:px-5 py-3.5">
                {tone ? (
                  <tone.icon aria-hidden="true" className={`w-5 h-5 mt-1 shrink-0 ${tone.className}`} />
                ) : (
                  // A plain fact: a quiet dot in the icon column.
                  <span aria-hidden="true" className="flex w-5 h-5 mt-1 shrink-0 items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-dust-2" />
                  </span>
                )}
                <p className="text-base sm:text-[1.0625rem] leading-relaxed text-bone-2">
                  {tone?.spoken && <span className="sr-only">{tone.spoken}</span>}
                  <Rich text={point.text} />
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {ideas.map((idea) => (
        <div key={idea.text} className="rz-well flex items-start gap-3 px-4 sm:px-5 py-3.5">
          <Lightbulb aria-hidden="true" className="w-5 h-5 mt-0.5 shrink-0 text-bone-2" />
          <div className="space-y-1">
            <p className="rz-label">Worth trying</p>
            <p className="text-base sm:text-[1.0625rem] leading-relaxed text-bone-2">
              <Rich text={idea.text} />
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// Marked figures in a point or to-do, set in bold bone so the numbers can be scanned.
function Rich({ text }: { text: string }) {
  return (
    <>
      {emphasisRuns(text).map((run, i) =>
        run.em ? (
          <strong key={i} className="font-semibold text-bone">
            {run.text}
          </strong>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        )
      )}
    </>
  );
}

function ChartPanel({ chart: { title, ...chart }, height, delay }: { chart: StoryChart; height: number; delay: number }) {
  return (
    <Panel title={title}>
      <ColumnChart {...chart} height={height} delay={delay} />
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rz-panel p-5 space-y-4">
      <h3 className="font-display font-semibold uppercase tracking-[0.06em] text-base text-bone">{title}</h3>
      {children}
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 h-5 items-center justify-center rounded border border-seam-strong bg-panel-2 px-1 font-sans text-[0.6875rem] text-bone-2">
      {children}
    </kbd>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isDigit(char: string) {
  return char >= "0" && char <= "9";
}

// The headline's words for its word-by-word entrance: split at spaces, each word keeping its
// marked and plain parts together, so punctuation stays with its figure ("₱16,400,").
function splitWords(text: string): Run[][] {
  const words: Run[][] = [];
  let word: Run[] = [];
  for (const run of emphasisRuns(text)) {
    for (const piece of run.text.split(/(\s+)/)) {
      if (piece === "") continue;
      if (/^\s+$/.test(piece)) {
        if (word.length > 0) words.push(word);
        word = [];
      } else {
        word.push({ text: piece, em: run.em });
      }
    }
  }
  if (word.length > 0) words.push(word);
  return words;
}

// How long autoplay stays on a slide: time to read its words (about 250 a minute) and look at
// its charts, between 6 and 18 seconds.
function readingTime(slide: StorySlide) {
  const text = [slide.headline, ...slide.points.map((point) => point.text), ...(slide.todo ?? []).map((item) => item.text)].map(plain).join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  const visuals = (slide.charts?.length ?? 0) + (slide.bars ? 1 : 0);
  return Math.min(18000, Math.max(6000, 2500 + words * 240 + visuals * 1500));
}

function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED).matches,
    () => false
  );
}

// The intro plays once a session, and never under reduced motion. Storage can be blocked
// (private windows): then it simply plays again.
function playsIntro() {
  if (window.matchMedia(REDUCED).matches) return false;
  try {
    return window.sessionStorage.getItem(INTRO_KEY) !== "1";
  } catch {
    return true;
  }
}

function markIntroPlayed() {
  try {
    window.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    // Storage blocked: the intro may play again next time.
  }
}
