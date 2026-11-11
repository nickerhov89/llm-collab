/** Whether a recent terminated worker should be relaunched on session restore. */
export function shouldRestartProviderOnRestore(args: {
  terminationReason?: string;
  archived: boolean;
  autoResumeAllowed: boolean;
}): boolean {
  if (args.archived || !args.autoResumeAllowed) return false;
  return /underlying process terminated|Claude SDK API error; restart required|^stale:/i.test(
    args.terminationReason ?? "",
  );
}
