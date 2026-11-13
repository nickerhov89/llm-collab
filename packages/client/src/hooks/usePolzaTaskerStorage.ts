import { useEffect, useRef, useState } from "react";
import { fetchJSON } from "../api/client";

interface Remote<T> {
  revision: number;
  accountKey: string;
  data: T;
}
interface TaskList {
  tasks: { id: string }[];
  profile?: unknown;
}

/** Server is authoritative; local storage is only a scoped legacy/recovery copy. */
export function usePolzaTaskerStorage<T extends TaskList>(
  key: string,
  parse: (raw: string) => T,
  empty: T,
) {
  const [data, setData] = useState<T>(empty);
  const [phase, setPhase] = useState<"loading" | "saving" | "saved" | "error">(
    "loading",
  );
  const [problem, setProblem] = useState<"load" | "save" | null>(null);
  const remote = useRef<Remote<T> | null>(null);
  const latest = useRef<T>(empty);
  const pending = useRef<T | null>(null);
  const saving = useRef(false);
  const failed = useRef(false);
  const alive = useRef(false);
  const reads = useRef(0);
  const edits = useRef(0);
  const unsaved = useRef(false);
  const draftKey = `${key}:server-draft`;
  const migratedKey = `${key}:server-migrated`;
  function cache(next: T) {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ revision: remote.current?.revision, data: next }),
      );
    } catch {
      /* Server persistence does not require browser storage. */
    }
  }
  async function pump() {
    if (saving.current || failed.current || !alive.current || !remote.current)
      return;
    saving.current = true;
    try {
      while (pending.current && alive.current && !failed.current) {
        const next = pending.current;
        const edit = edits.current;
        pending.current = null;
        setPhase("saving");
        try {
          const base = remote.current;
          if (!base) throw new Error("Tasker not loaded");
          const result: Remote<T> = await fetchJSON<Remote<T>>("/tasker", {
            method: "PUT",
            body: JSON.stringify({
              revision: base.revision,
              accountKey: base.accountKey,
              data: next,
            }),
          });
          remote.current = {
            ...result,
            data: parse(JSON.stringify(result.data)),
          };
          if (edit === edits.current && !pending.current)
            unsaved.current = false;
          try {
            localStorage.setItem(migratedKey, "1");
            if (pending.current) cache(pending.current);
            else if (!unsaved.current) localStorage.removeItem(draftKey);
            else {
              const raw = localStorage.getItem(draftKey);
              if (raw) cache(parse(JSON.stringify(JSON.parse(raw).data)));
            }
          } catch {
            /* Optional recovery cache. */
          }
          if (alive.current) setPhase(pending.current ? "saving" : "saved");
        } catch {
          pending.current ??= latest.current;
          cache(pending.current);
          failed.current = true;
          if (alive.current) {
            setProblem("save");
            setPhase("error");
          }
        }
      }
    } finally {
      saving.current = false;
    }
  }
  function persist(next: T): boolean {
    if (!remote.current || failed.current) return false;
    edits.current++;
    unsaved.current = true;
    latest.current = next;
    pending.current = next;
    cache(next);
    if (alive.current) {
      setData(next);
      void pump();
    }
    return true;
  }
  async function load(serverOnly = false) {
    if (saving.current || (pending.current && !failed.current)) return;
    const read = ++reads.current;
    const edit = edits.current;
    failed.current = false;
    setProblem(null);
    if (!remote.current) setPhase("loading");
    try {
      const result = await fetchJSON<Remote<T>>("/tasker");
      if (!alive.current || read !== reads.current || edit !== edits.current)
        return;
      if (
        !Number.isSafeInteger(result.revision) ||
        result.revision < 0 ||
        typeof result.accountKey !== "string"
      )
        throw new Error("Invalid server state");
      result.data = parse(JSON.stringify(result.data));
      remote.current = result;
      pending.current = null;
      unsaved.current = false;
      if (serverOnly) {
        try {
          const backup = localStorage.getItem(draftKey);
          if (backup) localStorage.setItem(`${draftKey}:backup`, backup);
          localStorage.removeItem(draftKey);
        } catch {
          /* Keep recovery data when storage is unavailable. */
        }
      }
      let candidate = result.data;
      let dirty = false;
      if (!serverOnly) {
        let raw: string | null = null;
        try {
          raw = localStorage.getItem(draftKey);
        } catch {
          /* Optional cache. */
        }
        if (raw) {
          const draft = JSON.parse(raw);
          const recovered = parse(JSON.stringify(draft.data));
          if (JSON.stringify(recovered) !== JSON.stringify(result.data)) {
            candidate = recovered;
            dirty = true;
            if (draft.revision !== result.revision) {
              latest.current = recovered;
              pending.current = recovered;
              failed.current = true;
              setData(recovered);
              setProblem("save");
              setPhase("error");
              return;
            }
          }
        } else {
          let legacy: string | null = null;
          try {
            if (!localStorage.getItem(migratedKey))
              legacy = localStorage.getItem(key);
          } catch {
            /* Optional migration. */
          }
          if (legacy) {
            const old = parse(legacy);
            const ids = new Set(result.data.tasks.map((t) => t.id));
            const added = old.tasks.filter((t) => !ids.has(t.id));
            candidate = {
              ...result.data,
              tasks: [...result.data.tasks, ...added],
              profile: result.data.profile ?? old.profile,
            };
            dirty = added.length > 0 || (!result.data.profile && !!old.profile);
          }
        }
      }
      latest.current = candidate;
      setData(candidate);
      setPhase("saved");
      if (dirty) persist(candidate);
      else {
        try {
          localStorage.setItem(migratedKey, "1");
          if (!serverOnly) localStorage.removeItem(draftKey);
        } catch {
          /* Optional cache. */
        }
      }
    } catch {
      if (alive.current && read === reads.current && edit === edits.current) {
        failed.current = true;
        setProblem("load");
        setPhase("error");
      }
    }
  }
  // The workspace remounts on scope changes; load only captures immutable scope/parser and refs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed workspace owns this lifecycle
  useEffect(() => {
    alive.current = true;
    void load();
    const focus = () => {
      if (
        !saving.current &&
        !pending.current &&
        !failed.current &&
        !unsaved.current
      )
        void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      reads.current++;
      window.removeEventListener("focus", focus);
    };
  }, [key]);
  return {
    data,
    setData: (next: T) => {
      edits.current++;
      unsaved.current = true;
      latest.current = next;
      cache(next);
      setData(next);
    },
    persist,
    phase,
    problem,
    loadError: phase === "loading" || problem !== null,
    reload: () => {
      void load(true);
    },
    retry: () => {
      if (pending.current && remote.current) {
        failed.current = false;
        setProblem(null);
        void pump();
      } else void load();
    },
  };
}
