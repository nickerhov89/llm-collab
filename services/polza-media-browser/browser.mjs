import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { allowedUrl } from "./config.mjs";
import { HttpError, activeActor } from "./authority.mjs";
import { savedAccount } from "./accounts.mjs";

const privateNetworks = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  privateNetworks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
])
  privateNetworks.addSubnet(network, prefix, "ipv6");
const privateAddress = (host) => {
  const normalized = host.replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost"))
    return true;
  const family = isIP(normalized);
  return family
    ? privateNetworks.check(normalized, family === 4 ? "ipv4" : "ipv6")
    : false;
};
const requireString = (value, max = 2000) => {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new HttpError(400, "invalid_string");
  return value;
};

export async function stageUpload(config, source, jobId, index) {
  requireString(source, 4096);
  const root = await fs.realpath(config.project);
  const file = await fs.realpath(source);
  if (!file.startsWith(`${root}${path.sep}`))
    throw new HttpError(400, "upload_outside_project");
  if (
    file
      .split(path.sep)
      .some(
        (part) =>
          part.startsWith(".") ||
          /credential|secret|password|login/i.test(part),
      )
  ) {
    throw new HttpError(400, "private_file_refused");
  }
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 15 * 1024 * 1024)
    throw new HttpError(400, "upload_limit_15mb");
  if (!/\.(png|jpg|jpeg|webp|gif|pdf|docx)$/i.test(file))
    throw new HttpError(400, "unsupported_upload_type");
  const directory = path.join(config.state, "uploads", jobId);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(
    directory,
    `${index}${path.extname(file).toLowerCase()}`,
  );
  // Copy the already opened regular file, not an asynchronously re-resolved symlink.
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size > 15 * 1024 * 1024 ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev
    ) {
      throw new HttpError(400, "upload_changed");
    }
    await fs.writeFile(destination, await handle.readFile(), { mode: 0o600 });
  } finally {
    await handle.close();
  }
  return destination;
}

export function validatePlan(config, body) {
  if (!Object.hasOwn(config.sites, body.site))
    throw new HttpError(400, "unknown_site");
  if (!["draft", "submit_review", "publish"].includes(body.intent))
    throw new HttpError(400, "invalid_intent");
  requireString(body.idempotencyKey, 120);
  requireString(body.title, 160);
  if (
    !Array.isArray(body.steps) ||
    body.steps.length < 1 ||
    body.steps.length > 80
  )
    throw new HttpError(400, "invalid_steps");
  const types = [
    "goto",
    "fill",
    "click",
    "press",
    "upload",
    "select",
    "expect",
  ];
  for (const step of body.steps) {
    if (!step || !types.includes(step.type))
      throw new HttpError(400, "invalid_action");
    if (step.type === "goto") allowedUrl(config.sites[body.site], step.url);
    else if (step.type === "expect") requireString(step.text, 1000);
    else {
      requireString(step.selector, 500);
      if (step.type === "fill") requireString(step.value, 100_000);
      if (
        step.type === "press" &&
        ![
          "Enter",
          "Tab",
          "Escape",
          "Backspace",
          "ControlOrMeta+A",
          "ArrowDown",
          "ArrowUp",
        ].includes(step.key)
      )
        throw new HttpError(400, "invalid_key");
      if (step.type === "select") requireString(step.value, 1000);
      if (step.type === "upload") requireString(step.path, 4096);
    }
  }
  if (body.steps.at(-1).type !== "expect")
    throw new HttpError(400, "final_evidence_required");
}

export class BrowserService {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.entries = new Map();
    this.launches = new Map();
    this.openSerial = Promise.resolve();
    this.loginAttempts = new Map();
    this.network = new Map();
    this.stopping = false;
    this.timer = setInterval(() => this.sweep().catch(() => {}), 30_000);
    this.timer.unref();
  }

  async publicRequest(raw) {
    const url = new URL(raw);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return false;
    if (url.port && !["80", "443"].includes(url.port)) return false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (privateAddress(host) || host.endsWith(".local") || !host.includes("."))
      return false;
    if (isIP(host)) return !privateAddress(host);
    const cached = this.network.get(host);
    if (cached && cached.until > Date.now()) return cached.allowed;
    let allowed = false;
    let deadline;
    try {
      const addresses = await Promise.race([
        lookup(host, { all: true }),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error("dns_timeout")), 2000);
        }),
      ]);
      allowed =
        addresses.length > 0 &&
        addresses.every(({ address }) => !privateAddress(address));
    } catch {
      /* Deny unresolved hosts. */
    } finally {
      clearTimeout(deadline);
    }
    if (this.network.size > 500) this.network.clear();
    this.network.set(host, { allowed, until: Date.now() + 60_000 });
    return allowed;
  }

  async open(siteId) {
    const operation = this.openSerial.then(() => this.openLocked(siteId));
    this.openSerial = operation.catch(() => {});
    return operation;
  }

  async openLocked(siteId) {
    if (this.stopping) throw new HttpError(503, "service_stopping");
    if (!Object.hasOwn(this.config.sites, siteId))
      throw new HttpError(404, "unknown_site");
    if (this.entries.has(siteId)) return this.entries.get(siteId);
    if (this.launches.has(siteId)) return this.launches.get(siteId);
    if (this.entries.size + this.launches.size >= this.config.maxBrowsers) {
      const idle = [...this.entries.values()]
        .filter(
          (entry) =>
            !entry.waitingJob &&
            (!entry.lease || entry.lease.until <= Date.now()),
        )
        .sort((a, b) => a.last - b.last)[0];
      if (!idle) throw new HttpError(409, "close_another_browser_first");
      await idle.context.close();
    }
    const pending = this.launch(siteId);
    this.launches.set(siteId, pending);
    try {
      return await pending;
    } finally {
      this.launches.delete(siteId);
    }
  }

  async launch(siteId) {
    const { chromium } = createRequire(this.config.playwright)(
      "@playwright/test",
    );
    const directory = path.join(this.config.profiles, siteId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    let context;
    try {
      context = await chromium.launchPersistentContext(directory, {
        executablePath: this.config.executable,
        timeout: 20_000,
        headless: this.config.headless,
        viewport: { width: 1280, height: 800 },
        acceptDownloads: false,
        serviceWorkers: "block",
        args: [
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--renderer-process-limit=2",
          "--disable-gpu",
        ],
      });
    } catch {
      throw new HttpError(409, "profile_busy_or_browser_unavailable");
    }
    const entry = {
      site: siteId,
      context,
      page: context.pages()[0] || (await context.newPage()),
      lease: null,
      last: Date.now(),
      serial: Promise.resolve(),
    };
    context.setDefaultTimeout(12_000);
    const watchPage = (page) => {
      page.on("filechooser", (chooser) => {
        entry.fileChooser = { chooser, until: Date.now() + 90_000 };
      });
    };
    for (const page of context.pages()) watchPage(page);
    context.on("page", (page) => {
      entry.page = page;
      watchPage(page);
    });
    context.on("close", () => {
      if (this.entries.get(siteId) === entry) this.entries.delete(siteId);
    });
    await context.route("**/*", async (route) => {
      try {
        const request = route.request();
        if (
          request.isNavigationRequest() &&
          request.frame() === request.frame().page().mainFrame()
        ) {
          allowedUrl(this.config.sites[siteId], request.url());
        }
        if (!(await this.publicRequest(request.url())))
          return await route.abort();
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });
    this.entries.set(siteId, entry);
    try {
      await entry.page.goto(this.config.sites[siteId].url, {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      });
    } catch {
      /* Return the browser for manual login or inspection even when navigation times out. */
    }
    return entry;
  }

  serial(entry, fn) {
    const operation = entry.serial.then(async () => {
      entry.last = Date.now();
      return fn();
    });
    entry.serial = operation.catch(() => {});
    return operation;
  }

  lease(entry, actor, client, takeover = false) {
    requireString(client, 100);
    const previous = entry.lease;
    if (
      previous &&
      previous.until > Date.now() &&
      (previous.actor !== actor || previous.client !== client) &&
      !takeover
    ) {
      throw new HttpError(409, "browser_has_controller");
    }
    if (entry.pointer && entry.pointer.client !== client)
      void this.serial(entry, () => this.cancelPointer(entry)).catch(() => {});
    entry.lease = { actor, client, until: Date.now() + this.config.leaseMs };
    return entry.lease;
  }

  async cancelPointer(entry) {
    if (!entry.pointer) return;
    entry.pointer = null;
    try {
      await entry.page.keyboard.press("Escape");
      // Releasing outside the page must not complete a drop or click a control.
      await entry.page.mouse.move(-1, -1);
    } finally {
      await entry.page.mouse.up();
    }
  }

  async release(entry, actor, client) {
    return this.serial(entry, async () => {
      this.controls(entry, actor, client);
      await this.cancelPointer(entry);
      entry.lease = null;
    });
  }

  controls(entry, actor, client) {
    const lease = entry.lease;
    if (
      !lease ||
      lease.actor !== actor ||
      lease.client !== client ||
      lease.until <= Date.now()
    )
      throw new HttpError(409, "control_lease_required");
    lease.until = Date.now() + this.config.leaseMs;
  }

  async status(entry) {
    return this.serial(entry, async () => {
      const page = entry.page;
      const data = await page.evaluate(() => {
        const tags = [
          "input",
          "textarea",
          "button",
          "select",
          "a",
          "[contenteditable=true]",
        ];
        const controls = [];
        for (const tag of tags) {
          document.querySelectorAll(tag).forEach((el, index) => {
            if (
              !el.getBoundingClientRect().width ||
              el.type === "password" ||
              el.type === "hidden"
            )
              return;
            const text = (
              el.innerText ||
              el.getAttribute("aria-label") ||
              el.getAttribute("placeholder") ||
              el.getAttribute("name") ||
              el.type ||
              ""
            )
              .trim()
              .slice(0, 180);
            if (tag === "a" && !text) return;
            controls.push({
              selector: `${tag} >> nth=${index}`,
              text,
              type: el.type || tag,
            });
          });
        }
        const body = document.body?.innerText || "";
        return {
          title: document.title,
          text: body.slice(0, 9000),
          controls: controls.slice(0, 180),
          auth: /captcha|капч|я не робот|я человек|checking your browser|smartcaptcha/i.test(
            body,
          )
            ? "challenge"
            : document.querySelector('input[type="password"]')
              ? "login_required"
              : "unverified",
        };
      });
      return {
        site: entry.site,
        url: page.url(),
        ...data,
        auth: (await this.challenge(entry)) ? "challenge" : data.auth,
        lease:
          entry.lease && entry.lease.until > Date.now()
            ? { actor: entry.lease.actor, until: entry.lease.until }
            : null,
      };
    });
  }

  async frame(entry) {
    return this.serial(entry, () =>
      entry.page.screenshot({ type: "jpeg", quality: 62, timeout: 8000 }),
    );
  }

  async input(entry, actor, client, action) {
    this.controls(entry, actor, client);
    return this.serial(entry, async () => {
      this.controls(entry, actor, client);
      const page = entry.page;
      switch (action.type) {
        case "pointer_start":
        case "pointer_move":
        case "pointer_end":
        case "pointer_cancel": {
          const points =
            action.type === "pointer_move" ? action.points : [action];
          if (
            action.type !== "pointer_cancel" &&
            (!Array.isArray(points) ||
              points.length < 1 ||
              points.length > 16 ||
              points.some(
                (point) =>
                  !point ||
                  !Number.isFinite(point.x) ||
                  !Number.isFinite(point.y) ||
                  point.x < 0 ||
                  point.x > 1280 ||
                  point.y < 0 ||
                  point.y > 800,
              ))
          )
            throw new HttpError(400, "invalid_pointer_path");
          if (action.type === "pointer_start") {
            await this.cancelPointer(entry);
            await page.mouse.move(action.x, action.y);
            entry.pointer = { actor, client };
            try {
              await page.mouse.down();
            } catch (error) {
              await this.cancelPointer(entry);
              throw error;
            }
            break;
          }
          if (!entry.pointer) {
            if (action.type === "pointer_cancel") break;
            throw new HttpError(409, "pointer_not_started");
          }
          if (entry.pointer.actor !== actor || entry.pointer.client !== client)
            throw new HttpError(409, "control_lease_required");
          if (action.type === "pointer_cancel") {
            await this.cancelPointer(entry);
            break;
          }
          try {
            for (const point of points) {
              this.controls(entry, actor, client);
              await page.mouse.move(point.x, point.y);
            }
            if (action.type === "pointer_end") {
              await page.mouse.up();
              entry.pointer = null;
            }
          } catch (error) {
            await this.cancelPointer(entry);
            throw error;
          }
          break;
        }
        case "drag": {
          const { points } = action;
          if (
            !Array.isArray(points) ||
            points.length < 2 ||
            points.length > 121 ||
            points.some(
              (point) =>
                !point ||
                !Number.isFinite(point.x) ||
                !Number.isFinite(point.y) ||
                point.x < 0 ||
                point.x > 1280 ||
                point.y < 0 ||
                point.y > 800,
            )
          )
            throw new HttpError(400, "invalid_drag_path");
          await page.mouse.move(points[0].x, points[0].y);
          await page.mouse.down();
          try {
            for (const point of points.slice(1)) {
              this.controls(entry, actor, client);
              await page.mouse.move(point.x, point.y, { steps: 2 });
            }
          } finally {
            await page.mouse.up();
          }
          break;
        }
        case "click": {
          const { x, y } = action;
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < 0 ||
            x > 1280 ||
            y < 0 ||
            y > 800
          )
            throw new HttpError(400, "invalid_coordinates");
          await page.mouse.click(x, y);
          break;
        }
        case "text":
          await page.keyboard.insertText(requireString(action.value, 100_000));
          break;
        case "key":
          if (
            ![
              "Enter",
              "Tab",
              "Escape",
              "Backspace",
              "ControlOrMeta+A",
              "ArrowDown",
              "ArrowUp",
            ].includes(action.key)
          )
            throw new HttpError(400, "invalid_key");
          await page.keyboard.press(action.key);
          break;
        case "scroll":
          await page.mouse.wheel(
            0,
            Math.max(-1600, Math.min(1600, Number(action.y) || 0)),
          );
          break;
        case "goto":
          await page.goto(
            allowedUrl(this.config.sites[entry.site], action.url),
            { waitUntil: "domcontentloaded" },
          );
          break;
        default:
          throw new HttpError(400, "invalid_input");
      }
    });
  }

  async step(entry, step) {
    if (step.type === "goto")
      return entry.page.goto(
        allowedUrl(this.config.sites[entry.site], step.url),
        { waitUntil: "domcontentloaded" },
      );
    if (step.type === "expect")
      return entry.page
        .getByText(step.text, { exact: false })
        .first()
        .waitFor({ state: "visible" });
    const target = entry.page.locator(step.selector);
    if ((await target.count()) !== 1)
      throw new HttpError(409, "selector_must_match_one_element");
    if ((await target.getAttribute("type")) === "password")
      throw new HttpError(403, "human_login_required");
    switch (step.type) {
      case "fill":
        return target.fill(step.value);
      case "click":
        return target.click();
      case "press":
        return target.press(step.key);
      case "select":
        return target.selectOption(step.value);
      case "upload":
        return target.setInputFiles(step.path);
      default:
        throw new HttpError(400, "invalid_action");
    }
  }

  handoff(site, job) {
    const params = new URLSearchParams({ site, ...(job ? { job } : {}) });
    return `${this.config.origin}/media/?${params}`;
  }

  async navigate(entry, actor, url) {
    const target = allowedUrl(this.config.sites[entry.site], url);
    if (entry.lease?.until > Date.now())
      throw new HttpError(409, "browser_has_controller");
    const client = `navigate-${Date.now()}`;
    this.lease(entry, actor, client);
    try {
      await this.serial(entry, async () => {
        this.controls(entry, actor, client);
        await entry.page.goto(target, { waitUntil: "domcontentloaded" });
      });
    } finally {
      if (entry.lease?.client === client) entry.lease = null;
    }
  }

  async challenge(entry) {
    return entry.page.evaluate(() => {
      const visible = (el) => {
        const box = el.getBoundingClientRect();
        return (
          box.width > 70 &&
          box.height > 25 &&
          getComputedStyle(el).visibility !== "hidden"
        );
      };
      const frames = [...document.querySelectorAll("iframe")].filter(visible);
      if (
        frames.some((frame) =>
          /recaptcha|hcaptcha|smartcaptcha|challenges\.cloudflare\.com/i.test(
            frame.src,
          ),
        )
      )
        return true;
      if (
        [
          ...document.querySelectorAll(
            ".g-recaptcha,.h-captcha,.smart-captcha,.cf-turnstile",
          ),
        ].some(visible)
      )
        return true;
      const text = document.body?.innerText || "";
      return (
        /подтвердите,? что вы (не робот|человек)|verify (that )?you are human|checking your browser|security verification required/i.test(
          text,
        ) || /just a moment|проверка безопасности/i.test(document.title)
      );
    });
  }

  async login(entry, actor) {
    if (entry.lease?.until > Date.now())
      throw new HttpError(409, "browser_has_controller");
    const account = await savedAccount(this.config, entry.site);
    if (!account)
      return {
        status: "credentials_missing",
        handoffUrl: this.handoff(entry.site),
      };
    const client = `login-${Date.now()}`;
    this.lease(entry, actor, client);
    try {
      return await this.serial(entry, async () => {
        allowedUrl(this.config.sites[entry.site], entry.page.url());
        let passwords = entry.page.locator('input[type="password"]:visible');
        if ((await passwords.count()) === 0) {
          if (await this.challenge(entry))
            return {
              status: "waiting_for_human",
              handoffUrl: this.handoff(entry.site),
            };
          const name = /^(войти|вход|sign in|log in|login)$/i;
          const candidates = entry.page
            .getByRole("button", { name })
            .or(entry.page.getByRole("link", { name }));
          const visible = [];
          for (let i = 0; i < (await candidates.count()); i++) {
            if (await candidates.nth(i).isVisible())
              visible.push(candidates.nth(i));
          }
          if (visible.length === 1) {
            await visible[0].click();
            await passwords
              .first()
              .waitFor({ state: "visible", timeout: 4000 })
              .catch(() => {});
          }
        }
        if ((await passwords.count()) > 1) {
          const loginButton = entry.page.getByRole("button", {
            name: /^(войти|вход|sign in|log in|login|авторизоваться)$/i,
          });
          if ((await loginButton.count()) === 1) {
            const loginForm = loginButton.locator("xpath=ancestor::form[1]");
            if ((await loginForm.count()) === 1)
              passwords = loginForm.locator('input[type="password"]:visible');
          }
        }
        if ((await passwords.count()) !== 1)
          return { status: "open_login_form_or_verify_existing_session" };
        const form = passwords.locator("xpath=ancestor::form[1]");
        const scope =
          (await form.count()) === 1 ? form : entry.page.locator("body");
        let username = scope.locator(
          'input[type="email"]:visible, input[name*="login" i]:visible:not([type="password"]), input[name*="email" i]:visible:not([type="password"]), input[autocomplete="username"]:visible',
        );
        if ((await username.count()) === 0)
          username = scope.locator(
            'input[placeholder="Email" i]:visible, input[placeholder="E-mail" i]:visible',
          );
        if ((await username.count()) !== 1)
          return {
            status: "ambiguous_login_form",
            handoffUrl: this.handoff(entry.site),
          };
        await username.fill(account.login);
        await passwords.fill(account.password);
        if (await this.challenge(entry))
          return {
            status: "waiting_for_human",
            credentialsFilled: true,
            handoffUrl: this.handoff(entry.site),
          };
        if (
          await scope
            .locator('input[type="checkbox"][required]:not(:checked)')
            .count()
        )
          return {
            status: "consent_requires_human",
            handoffUrl: this.handoff(entry.site),
          };
        const submit = scope.getByRole("button", {
          name: /^(войти|вход|sign in|log in|login|авторизоваться)$/i,
        });
        if ((await submit.count()) !== 1)
          return {
            status: "credentials_filled_manual_submit",
            handoffUrl: this.handoff(entry.site),
          };
        if (this.loginAttempts.get(entry.site) > Date.now() - 300_000)
          return {
            status: "login_retry_limited",
            handoffUrl: this.handoff(entry.site),
          };
        this.loginAttempts.set(entry.site, Date.now());
        await submit.click();
        return {
          status: (await this.challenge(entry))
            ? "waiting_for_human"
            : "login_submitted_verify_snapshot",
          handoffUrl: this.handoff(entry.site),
        };
      });
    } catch {
      throw new HttpError(409, "login_requires_human_inspection");
    } finally {
      if (entry.lease?.client === client) entry.lease = null;
    }
  }

  async resume(job) {
    if (
      job.status !== "waiting_for_human" ||
      !Number.isInteger(job.result?.resumeFrom)
    )
      throw new HttpError(409, "job_requires_manual_review_no_replay");
    const entry = this.entries.get(job.site);
    if (!entry) throw new HttpError(409, "same_browser_session_required");
    if (entry.lease?.until > Date.now())
      throw new HttpError(409, "browser_has_controller");
    if (await this.challenge(entry))
      throw new HttpError(409, "human_verification_still_required");
    entry.waitingJob = null;
    this.store.update(job.id, "queued", {
      resumeFrom: job.result.resumeFrom,
      humanCheckCompleted: true,
    });
  }

  async run(job) {
    if (!(await activeActor(this.config, job.actor))) {
      this.store.update(job.id, "cancelled", { reason: "access_revoked" });
      return;
    }
    let entry;
    try {
      entry = await this.open(job.site);
    } catch (error) {
      if (error.message === "close_another_browser_first") return;
      this.store.update(job.id, "needs_review", {
        reason: "browser_unavailable",
      });
      return;
    }
    if (
      entry.lease?.until > Date.now() ||
      this.store.get(job.id)?.status !== "queued"
    )
      return;
    this.lease(entry, job.actor, job.id);
    let completed = job.result?.resumeFrom || 0;
    this.store.update(job.id, "running", { nextStep: completed });
    try {
      for (const [index, step] of job.plan.entries()) {
        if (index < completed) continue;
        if (this.stopping || !(await activeActor(this.config, job.actor)))
          throw new HttpError(409, "access_revoked_or_stopping");
        this.controls(entry, job.actor, job.id);
        await this.serial(entry, async () => {
          this.controls(entry, job.actor, job.id);
          if (await this.challenge(entry))
            throw new HttpError(409, "human_verification_required");
          await this.step(entry, step);
        });
        completed = index + 1;
        this.store.update(job.id, "running", { nextStep: completed });
      }
      const screenshot = await this.frame(entry);
      await fs.mkdir(path.join(this.config.state, "evidence"), {
        recursive: true,
        mode: 0o700,
      });
      await fs.writeFile(
        path.join(this.config.state, "evidence", `${job.id}.jpg`),
        screenshot,
        { mode: 0o600 },
      );
      this.store.update(job.id, "completed", {
        url: entry.page.url(),
        completedSteps: completed,
        expectedText: job.plan.at(-1).text,
        evidence: true,
        note: "Plan and visible assertion passed; moderation/publication status is determined by the platform.",
      });
    } catch (error) {
      // Never include Playwright errors: they can contain field values and passwords.
      const safeHandoff = error.message === "human_verification_required";
      if (safeHandoff) entry.waitingJob = job.id;
      this.store.update(
        job.id,
        safeHandoff ? "waiting_for_human" : "needs_review",
        {
          nextStep: completed,
          ...(safeHandoff
            ? {
                resumeFrom: completed,
                handoffUrl: this.handoff(job.site, job.id),
              }
            : {}),
          reason: safeHandoff
            ? "human_verification_required"
            : "interrupted_or_assertion_failed_no_replay",
          url: entry.page.url(),
        },
      );
    } finally {
      if (entry.lease?.client === job.id) entry.lease = null;
    }
  }

  async tick() {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      for (const job of this.store.pending()) {
        if (!this.stopping) await this.run(job);
      }
    } finally {
      this.running = false;
    }
  }

  async closeSite(siteId, actor, client) {
    const entry = this.entries.get(siteId);
    if (!entry) return;
    this.controls(entry, actor, client);
    await entry.context.close();
  }

  async sweep() {
    for (const entry of this.entries.values()) {
      if (entry.pointer && (!entry.lease || entry.lease.until < Date.now()))
        await this.serial(entry, () => this.cancelPointer(entry));
      if (
        entry.last < Date.now() - this.config.idleMs &&
        (!entry.lease || entry.lease.until < Date.now())
      )
        await entry.context.close();
    }
  }

  async close() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.openSerial.catch(() => {});
    await Promise.allSettled([...this.launches.values()]);
    await Promise.allSettled(
      [...this.entries.values()].map((entry) => entry.context.close()),
    );
  }
}
