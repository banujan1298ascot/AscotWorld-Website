"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { staffCollection } from "./seed";
import { roleCan, type Capability, type StaffMember } from "./types";

/* ============================================================================
 * Demo authentication
 * ----------------------------------------------------------------------------
 * This is a front-end demo: credentials live in seed data and the "session" is
 * a staff id in browser storage. It is deliberately not secure and must be
 * replaced before the portal handles real staff accounts.
 *
 * TO MOVE TO REAL AUTH: keep this file's public shape (`useAuth` returning
 * user / signIn / signOut / can) and swap the internals for your provider —
 * every screen already gates on capabilities rather than checking roles or
 * reading the session directly.
 * ========================================================================= */

const SESSION_KEY = "ascotworld:session";

/* -------------------------------------------------------------------------- */
/* Session, held in browser storage and read as an external store             */
/* -------------------------------------------------------------------------- */

const sessionListeners = new Set<() => void>();

function subscribeSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function getSessionSnapshot(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function getServerSessionSnapshot(): string | null {
  return null;
}

function writeSession(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable — nothing more we can do in a demo build.
  }
  sessionListeners.forEach((l) => l());
}

/**
 * False during server render and the first hydration pass, true afterwards.
 * Screens use it to hold off on "you are signed out" until browser storage has
 * actually been read — otherwise the portal would bounce to /login on load.
 */
const noopSubscribe = () => () => {};

function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/* -------------------------------------------------------------------------- */

interface AuthValue {
  user: StaffMember | null;
  /** False until the stored session has been read on the client. */
  ready: boolean;
  signIn: (email: string, password: string) => { ok: true } | { ok: false; error: string };
  signInAs: (staffId: string) => void;
  signOut: () => void;
  /** Capability check — always prefer this over inspecting `user.role`. */
  can: (capability: Capability) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const userId = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );
  const ready = useIsHydrated();

  const user = useMemo(() => {
    if (!userId) return null;
    return staffCollection.find(userId) ?? null;
  }, [userId]);

  const signIn = useCallback<AuthValue["signIn"]>((email, password) => {
    const match = staffCollection
      .all()
      .find((s) => s.email.toLowerCase() === email.trim().toLowerCase());

    if (!match) return { ok: false, error: "No account found with that email address." };
    if (match.demoPassword !== password) {
      return { ok: false, error: "That password is incorrect. Demo password is demo1234." };
    }
    writeSession(match.id);
    return { ok: true };
  }, []);

  const signInAs = useCallback((staffId: string) => writeSession(staffId), []);
  const signOut = useCallback(() => writeSession(null), []);

  const can = useCallback(
    (capability: Capability) => (user ? roleCan(user.role, capability) : false),
    [user],
  );

  const value = useMemo<AuthValue>(
    () => ({ user, ready, signIn, signInAs, signOut, can }),
    [user, ready, signIn, signInAs, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}
