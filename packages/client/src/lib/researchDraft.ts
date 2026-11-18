import {
  getCanonicalInvocationToken,
  type SlashCommand,
} from "@yep-anywhere/shared";

const prefix = /^(\s*)[/$]deep-research(?=\s|$)(?:[ \t])?/i;
export function hasResearchDraft(text: string): boolean {
  return prefix.test(text);
}
/** Only the leading skill marker is managed; the user's research brief stays intact. */
export function researchDraft(
  text: string,
  token: string | null,
  toggle: boolean,
): string {
  const match = prefix.exec(text);
  if (match) {
    const brief = match[1] + text.slice(match[0].length);
    return toggle
      ? brief
      : token
        ? `${match[1]}${token} ${text.slice(match[0].length)}`
        : text;
  }
  return toggle && token ? `${token} ${text}` : text;
}
export function researchToken(
  commands: readonly SlashCommand[],
): string | null {
  const command = commands.find(
    (c) =>
      c.name.replace(/^\/+/, "").toLowerCase() === "deep-research" &&
      c.invocation?.kind === "skill",
  );
  return command ? getCanonicalInvocationToken(command) : null;
}
