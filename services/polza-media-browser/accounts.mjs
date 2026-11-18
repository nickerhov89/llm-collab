import fs from "node:fs/promises";

const aliases = {
  workspace: ["workspace.ru"],
  ruward: ["ruward", "ruward.ru"],
  vc: ["vc.ru"],
  spark: ["spark.ru"],
  habr: ["habr.com"],
  pressfeed: ["pressfeed", "pressfeed.ru"],
  sostav: ["sostav", "sostav.ru"],
  cms: ["cmsmagazine.ru", "CMS Magazine / Рейтинг Рунета"],
  rbc: ["companies.rbc.ru", "РБК Компании"],
  executive: ["e-xecutive.ru", "Executive.ru"],
  marketingtech: ["marketing-tech.ru"],
  adpass: ["adpass.ru"],
  dtf: ["dtf.ru"],
};

export async function savedAccount(config, site) {
  let data;
  try {
    data = JSON.parse(await fs.readFile(config.credentials, "utf8"));
  } catch {
    return null;
  }
  const accounts = Array.isArray(data) ? data : data.accounts;
  if (!Array.isArray(accounts)) return null;
  return (
    accounts.find(
      (account) =>
        aliases[site]?.some(
          (name) =>
            name.toLowerCase() === String(account.platform).toLowerCase(),
        ) &&
        typeof account.login === "string" &&
        typeof account.password === "string" &&
        account.password.length > 0,
    ) || null
  );
}

export async function credentialCoverage(config) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(config.sites).map(async ([id, site]) => [
        id,
        site.channel === "editorial_email"
          ? "use_corporate_gmail"
          : (await savedAccount(config, id))
            ? "saved"
            : "missing_or_registration_pending",
      ]),
    ),
  );
}
