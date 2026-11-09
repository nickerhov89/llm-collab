export type PolzaSpeechLanguage = "ru-RU" | "en-US" | "auto";

const STORAGE_KEY = "polza.speechLanguage";
const CHANGE_EVENT = "polza:speech-language-change";
let inMemoryLanguage: PolzaSpeechLanguage = "ru-RU";

export function getPolzaSpeechLanguage(): PolzaSpeechLanguage {
  if (typeof window === "undefined") return "ru-RU";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    inMemoryLanguage =
      value === "en-US" || value === "auto" || value === "ru-RU"
        ? value
        : inMemoryLanguage;
    return inMemoryLanguage;
  } catch {
    return inMemoryLanguage;
  }
}

export function setPolzaSpeechLanguage(value: PolzaSpeechLanguage): void {
  inMemoryLanguage = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Keep the selected language for this tab even if storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribePolzaSpeechLanguage(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
