import os from "node:os";
import path from "node:path";

export const SITES = {
  workspace: {
    name: "Workspace",
    url: "https://workspace.ru/personal/cases/",
    domains: ["workspace.ru"],
  },
  ruward: {
    name: "RUWARD",
    url: "https://ruward.ru/lk/agency-management/case/",
    domains: ["ruward.ru"],
  },
  sostav: {
    name: "Sostav",
    url: "https://www.sostav.ru/blogs/295768/",
    domains: ["sostav.ru"],
  },
  vc: { name: "vc.ru", url: "https://vc.ru/editor", domains: ["vc.ru"] },
  spark: {
    name: "Spark",
    url: "https://spark.ru/user/258650",
    domains: ["spark.ru"],
  },
  habr: {
    name: "Habr",
    url: "https://habr.com/ru/",
    domains: ["habr.com", "account.habr.com"],
  },
  pressfeed: {
    name: "Pressfeed",
    url: "https://pressfeed.ru/",
    domains: ["pressfeed.ru"],
  },
  cms: {
    name: "CMS Magazine / Рейтинг Рунета",
    url: "https://cmsmagazine.ru/cabinet/",
    domains: ["cmsmagazine.ru", "ratingruneta.ru"],
  },
  rbc: {
    name: "РБК Компании",
    url: "https://companies.rbc.ru/",
    domains: ["companies.rbc.ru", "auth.rbc.ru"],
  },
  marketingtech: {
    name: "MARKETING-TECH",
    url: "https://marketing-tech.ru/",
    domains: ["marketing-tech.ru"],
  },
  adpass: { name: "ADPASS", url: "https://adpass.ru/", domains: ["adpass.ru"] },
  executive: {
    name: "Executive.ru",
    url: "https://www.e-xecutive.ru/",
    domains: ["e-xecutive.ru"],
  },
  dtf: { name: "DTF", url: "https://dtf.ru/", domains: ["dtf.ru"] },
  cossa: {
    name: "Cossa",
    url: "https://www.cossa.ru/rules/",
    domains: ["cossa.ru"],
    channel: "editorial_email",
  },
  rb: {
    name: "RB.RU",
    url: "https://rb.ru/blogers/",
    domains: ["rb.ru"],
    channel: "editorial_email",
  },
  adindex: {
    name: "AdIndex",
    url: "https://adindex.ru/contacts.phtml",
    domains: ["adindex.ru"],
    channel: "editorial_email",
  },
  texterra: {
    name: "TexTerra",
    url: "https://texterra.ru/blog/stante-nashim-avtorom/",
    domains: ["texterra.ru"],
    channel: "editorial_email",
  },
};

export const EXTERNAL_CHANNELS = [
  {
    id: "tbusiness",
    name: "Т-Бизнес секреты",
    url: "https://t.me/bs_community_bot",
    channel: "telegram_bot",
    status:
      "Telegram @sorichev; отдельного пароля нет; доступ VPS к Telegram не подтверждён",
  },
];

export function configuration(env = process.env) {
  const home = os.homedir();
  return {
    port: Number(env.MEDIA_PORT || 3410),
    core: env.MEDIA_CORE || "http://127.0.0.1:3400",
    origin: env.MEDIA_ORIGIN || "",
    state:
      env.MEDIA_STATE || path.join(home, ".local/state/polza-media-browser"),
    profiles:
      env.MEDIA_PROFILES || path.join(home, ".config/polza-seo-pr-browser"),
    authority: env.MEDIA_AUTHORITY || path.join(home, ".yep-anywhere"),
    credentials:
      env.MEDIA_CREDENTIALS ||
      path.join(home, ".config/polza-media/current-accounts.json"),
    project: env.MEDIA_PROJECT || "/home/manager/work/polza-seo-pr",
    sqlite:
      env.MEDIA_SQLITE ||
      new URL("../../packages/shared/dist/sqlite.js", import.meta.url).pathname,
    playwright:
      env.MEDIA_PLAYWRIGHT ||
      new URL("../../packages/client/package.json", import.meta.url).pathname,
    executable: env.MEDIA_CHROMIUM || undefined,
    headless: env.MEDIA_HEADLESS !== "false",
    sites: SITES,
    maxBrowsers: Number(env.MEDIA_MAX_BROWSERS || 1),
    idleMs: 10 * 60_000,
    leaseMs: 90_000,
  };
}

export function projectId(config) {
  return Buffer.from(config.project).toString("base64url");
}

export function allowedUrl(site, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("site_url_only");
  }
  if (
    !site.domains.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new Error("site_url_only");
  }
  return url.href;
}
