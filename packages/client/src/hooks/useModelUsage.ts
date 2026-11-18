import type { ModelUsageSummary } from "@yep-anywhere/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";

/** One explicit read per source/view; no idle polling or provider processes. */
export function useModelUsage() {
  const sourceKey = useClientSummarySourceKey();
  const [state, setState] = useState<{
    sourceKey: typeof sourceKey;
    usage: ModelUsageSummary | null;
  }>({ sourceKey, usage: null });
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const { usage } = await api.getModelUsage(controller.signal);
      if (!controller.signal.aborted) setState({ sourceKey, usage });
    } catch {
      if (!controller.signal.aborted) setState({ sourceKey, usage: null });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [sourceKey]);
  useEffect(() => {
    void refresh();
    return () => pending.current?.abort();
  }, [refresh]);
  return {
    usage: state.sourceKey === sourceKey ? state.usage : null,
    loading,
    refresh,
  };
}
