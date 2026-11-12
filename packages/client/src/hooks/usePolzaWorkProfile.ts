import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useActingPrincipal } from "./useActingPrincipal";
import { useClientSummarySourceKey } from "../lib/clientSummarySourceKey";
import {
  defaultWorkProfile,
  parseWorkProfile,
  readWorkProfile,
  type WorkProfile,
} from "../lib/polzaWorkProfile";
const eventName = "polza-owner-work-profile";
function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", listener);
  };
}
export function usePolzaWorkProfile() {
  const { principal, resolved } = useActingPrincipal();
  const source = useClientSummarySourceKey();
  const key = `polza-owner-work-profile:${source}`;
  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }, [key]),
    () => null,
  );
  const profile = useMemo(() => {
    if (!resolved) return null;
    if (principal.username !== null)
      return readWorkProfile(principal.grants?.instructionBlocks ?? []);
    try {
      return (
        (raw ? parseWorkProfile(JSON.parse(raw)) : null) ??
        defaultWorkProfile("admin")
      );
    } catch {
      return defaultWorkProfile("admin");
    }
  }, [principal, resolved, raw]);
  const saveOwner = (next: WorkProfile) => {
    if (!resolved || principal.username !== null) return;
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(eventName));
  };
  return { profile, saveOwner, owner: resolved && principal.username === null };
}
