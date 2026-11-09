export function polzaModelLabel(value: string): string {
  const match = /^gpt-(\d+(?:\.\d+)?)-([a-z][\w-]*)$/i.exec(value);
  if (!match) return value === "default" ? "Default" : value;
  const family = match[1];
  const suffix = (match[2] ?? "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return `GPT-${family} ${suffix}`;
}
