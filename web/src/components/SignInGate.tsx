"use client";

// Staff sign-in on the phone (slice 19). Wraps /pos and /shift-log on the client, so the cached
// pages still open with the shop PC off; there is no server redirect in front of them.
//
// - Not approved yet: the approval step comes first (Decision 5).
// - Then sign-in, when the page opens and whenever the POS starts a new ticket (`checkpoint`),
//   never between Charge and Record (case 2). Today's session ends at midnight Manila.
// - A phone with no binding is assigned to the barber at the first online sign-in, through the
//   normal first bind (case 7). Moving a bound phone still needs the owner PIN ("Change the barber").
// - While the PC answers, the account is rechecked; a reset password or a deactivated account ends
//   the session (Decision 10). Signing in never changes who a sale is credited to.
// - An owner sign-in on this browser ends the barber's session (slice 19 §7.13): at once in other
//   tabs (`storage` event), and at the next recheck through SESSION_REPLACED.

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";
import { db, getOrCreateDeviceKey, type LocalDeviceBinding } from "@/lib/db";
import {
  applySessionAnswer,
  endLocalSession,
  readLocalSession,
  signIn,
  signInNeeded,
  staffSessionChanged,
  type LocalSession,
} from "@/lib/local-session";
import { browserRandom, browserStorage, browserSubtle, checkSessionOnline, loginOnline, logoutOnline } from "@/lib/sign-in-client";
import { createLocalAssignment, isWaitingForApproval, registerPendingAssignment, subscribeApproval } from "@/lib/sync";
import { gateScreen } from "@/lib/approval-gate";
import { ApprovalScreen } from "@/components/ApprovalScreen";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { Logo } from "@/components/Logo";

type GateContext = {
  /** Today's sign-in on this phone; null while the sign-in screen is up. */
  session: LocalSession | null;
  /** A new ticket starts: asks for sign-in if today's session ended, and rechecks it with the PC. */
  checkpoint: () => void;
  /** Ends today's session and asks for sign-in. Queued sales are untouched. */
  signOut: () => void;
  /**
   * True while a sale is between Charge and Record: the sign-in screen waits until it is false
   * (case 2), even if a recheck ended the session meanwhile.
   */
  holdSignIn: (hold: boolean) => void;
  /** The binding the gate made at a first sign-in (case 7), for the page to pick up. */
  createdBinding: LocalDeviceBinding | null;
};

const Gate = createContext<GateContext | null>(null);

export function useStaffSession(): GateContext {
  const value = useContext(Gate);
  if (!value) throw new Error("useStaffSession must be used inside <SignInGate>");
  return value;
}

async function currentBinding() {
  try {
    return (await db.deviceBindings.get(getOrCreateDeviceKey())) ?? null;
  } catch {
    return null;
  }
}

export function SignInGate({ title, children }: { title: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<LocalSession | null>(null);
  // False until the first sign-in of this page visit: until then the page itself doesn't render.
  const [ready, setReady] = useState(false);
  // Approval is asked for when the page opens or a ticket starts, not the moment a sync is refused.
  const [askApproval, setAskApproval] = useState(false);
  const [hold, setHold] = useState(false);
  const [createdBinding, setCreatedBinding] = useState<LocalDeviceBinding | null>(null);
  const waiting = useSyncExternalStore(subscribeApproval, isWaitingForApproval, () => false);
  const checking = useRef(false);
  const pathname = usePathname() ?? "/pos";

  // Decision 10 and slice 19 §7.13: only PASSWORD_CHANGED, INACTIVE or SESSION_REPLACED end the
  // session; no cookie, an expired cookie or no answer keep it.
  const recheck = useCallback(async () => {
    if (checking.current || typeof navigator === "undefined" || !navigator.onLine) return;
    checking.current = true;
    try {
      const storage = browserStorage();
      if (!readLocalSession(storage)) return;
      if (applySessionAnswer(await checkSessionOnline(storage), storage) === "ended") setSession(null);
    } finally {
      checking.current = false;
    }
  }, []);

  // The local session, valid only for today and for the phone's binding.
  const loadSession = useCallback(async () => {
    const binding = await currentBinding();
    setAskApproval(isWaitingForApproval());
    const storage = browserStorage();
    const local = readLocalSession(storage);
    if (signInNeeded(local, new Date(), binding?.barberId ?? null)) {
      endLocalSession(storage);
      setSession(null);
      return null;
    }
    setSession(local);
    return local;
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadSession().then((local) => {
        if (!active) return;
        setMounted(true);
        if (local) {
          setReady(true);
          void recheck();
        }
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loadSession, recheck]);

  // Slice 19 §7.13: another tab changed the sign-in (the owner signed in there, or a barber signed
  // in or out): reread it, so this POS never keeps a stale barber session. A sale between Charge
  // and Record still finishes first (`hold`).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (staffSessionChanged(event.key)) void loadSession();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadSession]);

  const checkpoint = useCallback(() => {
    void loadSession().then((local) => { if (local) void recheck(); });
  }, [loadSession, recheck]);

  const signOut = useCallback(() => {
    endLocalSession(browserStorage());
    setSession(null);
    void logoutOnline();
  }, []);

  const onSignedIn = useCallback((local: LocalSession, binding: LocalDeviceBinding | null) => {
    if (binding) setCreatedBinding(binding);
    setSession(local);
    setReady(true);
  }, []);

  if (!mounted) {
    return (
      <div role="status" className="rz-page flex-1 flex items-center justify-center gap-3 text-dust">
        <BarberPoleIcon className="w-3.5 h-8" spinning />
        <span>Loading…</span>
      </div>
    );
  }

  const needsApproval = waiting && (askApproval || !ready);
  // Slice 19 §7, Decision 2: approval first, then the barber's sign-in. Owner access never counts here.
  const screen = gateScreen({ pathname, approved: !needsApproval, ownerAccess: false }) === "approval"
    ? <ApprovalScreen title={title} />
    : <SignInScreen title={title} onSignedIn={onSignedIn} />;

  // Before the first sign-in the page isn't rendered at all.
  if (!ready) return screen;

  // Later the screen covers the page, so a ticket in progress is never lost to a sign-in.
  const covered = !hold && (needsApproval || !session);
  return (
    <Gate.Provider value={{ session, checkpoint, signOut, holdSignIn: setHold, createdBinding }}>
      {covered && <div className="fixed inset-0 z-[60] flex overflow-y-auto bg-wall">{screen}</div>}
      <div inert={covered} className="flex-1 flex flex-col">{children}</div>
    </Gate.Provider>
  );
}

function SignInScreen({ title, onSignedIn }: { title: string; onSignedIn: (session: LocalSession, binding: LocalDeviceBinding | null) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bound, setBound] = useState<LocalDeviceBinding | null>(null);

  useEffect(() => {
    void currentBinding().then(setBound);
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const binding = await currentBinding();
      const storage = browserStorage();
      const result = await signIn(username, password, {
        login: loginOnline,
        storage,
        now: () => new Date(),
        bound: binding ? { barberId: binding.barberId, barberName: binding.barberName } : null,
        subtle: browserSubtle(),
        random: browserRandom,
      });
      if (!result.ok) {
        // The server may have set its cookie before the phone refused (its own binding differs).
        if (result.online && result.code === "PHONE_ASSIGNED") void logoutOnline();
        setError(result.message);
        setPassword("");
        return;
      }
      let created: LocalDeviceBinding | null = null;
      if (!binding) {
        // Case 7: no binding yet. Only an online sign-in leads to a bind (a first bind needs no PIN).
        if (!result.online) {
          endLocalSession(storage);
          setError("This phone has no barber yet. Sign in once with the shop PC on.");
          return;
        }
        created = await createLocalAssignment({ id: result.session.barberId, fullName: result.session.barberName });
        const bind = await registerPendingAssignment();
        if (bind.status === "rejected") {
          endLocalSession(storage);
          setError("The shop PC refused to assign this phone. Ask the owner.");
          return;
        }
      }
      setPassword("");
      onSignedIn(result.session, created);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6 w-full">
      <form
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
        className="animate-pop rz-panel w-full max-w-sm p-6 sm:p-7 space-y-5"
        aria-labelledby="staff-sign-in-title"
      >
        <div className="flex flex-col items-center text-center gap-3">
          <Logo stacked />
          <h1 id="staff-sign-in-title" className="rz-title text-3xl">{title}</h1>
          <p className="text-sm text-dust leading-relaxed">
            {bound ? `Sign in with ${bound.barberName}'s account to start today's sales.` : "Sign in with your own account to start today's sales."}
          </p>
        </div>
        <label className="block space-y-1.5">
          <span className="rz-field-label">Username</span>
          <input
            autoFocus
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="rz-field min-h-12 w-full"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="rz-field-label">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rz-field min-h-12 w-full"
          />
        </label>
        <button disabled={busy || !username.trim() || !password} className="rz-btn rz-btn-primary w-full min-h-12">
          <LogIn className="w-4 h-4" />
          {busy ? "Checking…" : "Sign in"}
        </button>
        {error && <p role="alert" className="animate-rise rz-notice rz-notice-danger">{error}</p>}
        <p className="text-xs text-dust text-center leading-relaxed">
          With the shop PC off, the phone checks the password itself if this account has signed in here before. Forgot it? The owner resets it on Staff accounts.
        </p>
      </form>
    </main>
  );
}
