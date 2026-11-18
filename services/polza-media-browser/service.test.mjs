import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { configuration, projectId } from "./config.mjs";
import { createService } from "./server.mjs";
import { stageUpload } from "./browser.mjs";
import { createStore } from "./store.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "polza-media-test-"));
  const config = {
    ...configuration(),
    state: path.join(root, "state"),
    profiles: path.join(root, "profiles"),
    authority: path.join(root, "authority"),
    project: path.join(root, "seo"),
    maxBrowsers: 1,
    sites: {
      workspace: {
        name: "Fixture",
        url: "https://fixture.polza.test/",
        domains: ["fixture.polza.test"],
      },
    },
  };
  await fs.mkdir(config.authority, { recursive: true });
  await fs.mkdir(config.project);
  await fs.writeFile(
    path.join(config.authority, "server-settings.json"),
    JSON.stringify({ settings: { limitedUsersEnabled: true } }),
  );
  const grants = { newSessionProjects: [projectId(config)] };
  const users = { users: { marker: grants, cfo: grants } };
  const saveUsers = () =>
    fs.writeFile(
      path.join(config.authority, "limited-users.json"),
      JSON.stringify(users),
    );
  await saveUsers();
  const core = http.createServer((req, res) => {
    if (req.url !== "/api/users/me") {
      res.writeHead(200, { "x-core": "yes" });
      res.end("core unchanged");
      return;
    }
    const actor = /who=(\w+)/.exec(req.headers.cookie || "")?.[1];
    if (!actor) {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        superuser: actor === "owner",
        username: actor === "owner" ? null : actor,
        grants,
      }),
    );
  });
  core.listen(0, "127.0.0.1");
  await once(core, "listening");
  config.core = `http://127.0.0.1:${core.address().port}`;
  const service = await createService(config);
  service.browser.publicRequest = async () => false;
  service.server.listen(0, "127.0.0.1");
  await once(service.server, "listening");
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  config.origin = origin;
  const request = (route, actor = "marker", data, headers = {}) =>
    fetch(`${origin}${route}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        cookie: `who=${actor}`,
        "content-type": "application/json",
        "x-yep-anywhere": "true",
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  t.after(async () => {
    await service.close();
    await new Promise((r) => core.close(r));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, config, origin, service, request, users, saveUsers, core };
}

test("proxy shuts down promptly with a live upgraded Cowork socket", {
  timeout: 10_000,
}, async (t) => {
  const { core, service, origin } = await fixture(t);
  core.on("upgrade", (_request, socket) => {
    socket.on("end", () => socket.destroy());
    socket.resume();
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
  });
  const client = net.connect(Number(new URL(origin).port), "127.0.0.1");
  t.after(() => client.destroy());
  await once(client, "connect");
  const received = once(client, "data");
  client.write(
    "GET /events HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  );
  assert.match((await received)[0].toString(), /101 Switching Protocols/);
  let timer;
  try {
    await Promise.race([
      service.close(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Live WebSocket blocked shutdown")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
});

test("proxy preserves core; media rejects anonymous, cfo, revoked grants, cross-origin and expired capabilities", async (t) => {
  const { request, service, users, saveUsers } = await fixture(t);
  const proxy = await request("/api/anything");
  assert.equal(await proxy.text(), "core unchanged");
  assert.equal(proxy.headers.get("x-core"), "yes");
  assert.equal((await request("/media/api/status", "")).status, 401);
  assert.equal((await request("/media/api/status", "cfo")).status, 403);
  assert.equal((await request("/media/api/status", "owner")).status, 200);
  assert.equal((await request("/media/api/status")).status, 200);
  assert.equal(
    (
      await request(
        "/media/api/agents",
        "marker",
        {},
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/media/api/agents", "marker", {}, { "x-yep-anywhere": "" }))
      .status,
    403,
  );
  const grant = service.store.issue("marker", ["workspace"]);
  const headers = { authorization: `Bearer ${grant.token}` };
  assert.equal(
    (await request("/media/agent/status", "", undefined, headers)).status,
    200,
  );
  assert.equal(
    (await request("/media/agent/agents", "", {}, headers)).status,
    404,
  );
  users.users.marker.disabled = true;
  await saveUsers();
  assert.equal((await request("/media/api/status")).status, 403);
  assert.equal(
    (await request("/media/agent/status", "", undefined, headers)).status,
    401,
  );
  users.users.marker.disabled = false;
  await saveUsers();
  service.store.revoke("marker");
  assert.equal(
    (await request("/media/agent/status", "", undefined, headers)).status,
    401,
  );
});

test("uploads confine symlinks, private files and content to project; queue is durable and idempotent", async (t) => {
  const { root, config, service, request } = await fixture(t);
  const good = path.join(config.project, "proof.png");
  await fs.writeFile(good, "image fixture");
  const outside = path.join(root, "outside.png");
  await fs.writeFile(outside, "secret");
  const symlink = path.join(config.project, "link.png");
  await fs.symlink(outside, symlink);
  await assert.rejects(
    stageUpload(config, symlink, "job", 0),
    /upload_outside_project/,
  );
  const privateFile = path.join(config.project, ".env.png");
  await fs.writeFile(privateFile, "secret");
  await assert.rejects(
    stageUpload(config, privateFile, "job", 0),
    /private_file_refused/,
  );
  const copy = await stageUpload(config, good, "job", 0);
  assert.equal(await fs.readFile(copy, "utf8"), "image fixture");
  // Keep the queued job from starting while testing durable admission.
  service.browser.running = true;
  const plan = {
    site: "workspace",
    title: "Draft fixture",
    intent: "draft",
    idempotencyKey: "once",
    steps: [{ type: "expect", text: "Saved" }],
  };
  const first = await (await request("/media/api/jobs", "marker", plan)).json();
  const second = await (
    await request("/media/api/jobs", "marker", plan)
  ).json();
  assert.equal(first.id, second.id);
  assert.equal(second.duplicate, true);
  assert.equal(service.store.list().length, 1);
  service.store.update(first.id, "running", { nextStep: 1 });
  service.browser.running = false;
  const restarted = await createStore(config);
  assert.equal(
    restarted.get(first.id).result.reason,
    "service_restarted_no_replay",
  );
  restarted.close();
  assert.equal(service.store.get(first.id).status, "needs_review");
});

test("real Chromium fills and uploads, human takeover interrupts queue, cookie persists, UI typing stays immediate", {
  timeout: 90_000,
}, async (t) => {
  const { config, service, request, origin } = await fixture(t);
  const entry = await service.browser.open("workspace");

  const fixtureHtml = `<!doctype html><html><body><h1>Editorial desk</h1><input name="title"><input type="password" value="never-export"><input type="file"><button id="save">Save draft</button><p id="result"></p><script>document.querySelector('#save').onclick=()=>{document.querySelector('#result').textContent='Draft saved: '+document.querySelector('[name=title]').value+' / '+document.querySelector('[type=file]').files.length};</script></body></html>`;
  await entry.context.unroute("**/*");
  await entry.context.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html", body: fixtureHtml }),
  );
  await entry.page.goto("https://fixture.polza.test/");
  await entry.context.addCookies([
    {
      name: "testsession",
      value: "alive",
      url: "https://fixture.polza.test/",
      expires: Date.now() / 1000 + 3600,
      secure: true,
    },
  ]);
  const snapshot = await service.browser.status(entry);
  assert.equal(
    snapshot.controls.some((c) => c.type === "password"),
    false,
  );
  assert.equal(JSON.stringify(snapshot).includes("never-export"), false);
  service.browser.lease(entry, "marker", "upload-test");
  await entry.page.locator("input[type=file]").click();
  const manual = await fetch(`${origin}/media/api/sites/workspace/file`, {
    method: "POST",
    headers: {
      cookie: "who=marker",
      "X-Yep-Anywhere": "true",
      "Content-Type": "application/octet-stream",
      "X-Media-Client": "upload-test",
      "X-Media-Filename": "proof.png",
    },
    body: Buffer.from("image fixture"),
  });
  assert.equal(manual.status, 200);
  assert.equal(
    await entry.page
      .locator("input[type=file]")
      .evaluate((input) => input.files.length),
    1,
  );
  entry.lease = null;
  await assert.rejects(
    service.browser.step(entry, {
      type: "fill",
      selector: "input[type=password]",
      value: "x",
    }),
    /human_login_required/,
  );
  const image = path.join(config.project, "proof.png");
  await fs.writeFile(image, "image");
  const plan = {
    site: "workspace",
    title: "Real draft",
    intent: "draft",
    idempotencyKey: "real",
    steps: [
      { type: "fill", selector: "[name=title]", value: "Unique story" },
      { type: "upload", selector: "input[type=file]", path: image },
      { type: "click", selector: "#save" },
      { type: "expect", text: "Draft saved: Unique story / 1" },
    ],
  };
  const job = service.store.add("marker", plan);
  await service.browser.tick();

  assert.equal(service.store.get(job.id).status, "completed");
  assert.equal(service.store.get(job.id).result.evidence, true);
  const challengeOriginalStep = service.browser.step.bind(service.browser);
  let publishingClicks = 0;
  service.browser.step = async (browser, step) => {
    await challengeOriginalStep(browser, step);
    if (step.type === "click") {
      publishingClicks++;
      await browser.page.evaluate(() => {
        const box = document.createElement("div");
        box.className = "smart-captcha";
        box.style.cssText = "width:200px;height:60px";
        box.textContent = "Fixture verification";
        document.body.append(box);
      });
    }
  };
  const captchaJob = service.store.add("marker", {
    ...plan,
    idempotencyKey: "captcha-handoff",
    steps: [
      { type: "click", selector: "#save" },
      { type: "expect", text: "Draft saved: Unique story / 1" },
    ],
  });
  await service.browser.tick();
  assert.equal(service.store.get(captchaJob.id).status, "waiting_for_human");
  assert.equal(service.store.get(captchaJob.id).result.resumeFrom, 1);
  await assert.rejects(
    service.browser.resume(service.store.get(captchaJob.id)),
    /human_verification_still_required/,
  );
  // Remove only our synthetic fixture element; no third-party CAPTCHA is involved.
  await entry.page.locator(".smart-captcha").evaluate((box) => box.remove());
  await service.browser.resume(service.store.get(captchaJob.id));
  await service.browser.tick();
  assert.equal(service.store.get(captchaJob.id).status, "completed");
  assert.equal(
    publishingClicks,
    1,
    "Resuming must not repeat a completed publication click",
  );
  service.browser.step = challengeOriginalStep;
  service.browser.lease(entry, "marker", "tab-one");
  assert.throws(
    () => service.browser.lease(entry, "marker", "tab-two"),
    /browser_has_controller/,
  );
  service.browser.lease(entry, "owner", "tab-owner", true);
  assert.throws(
    () => service.browser.controls(entry, "marker", "tab-one"),
    /control_lease_required/,
  );
  entry.lease = null;
  const interrupted = service.store.add("marker", {
    ...plan,
    idempotencyKey: "takeover",
    steps: [
      { type: "click", selector: "#save" },
      { type: "expect", text: "Will not run" },
    ],
  });
  const original = service.browser.step.bind(service.browser);
  service.browser.step = async (browser, step) => {
    await original(browser, step);
    service.browser.lease(browser, "owner", "human", true);
  };
  await service.browser.tick();

  assert.equal(service.store.get(interrupted.id).status, "needs_review");
  assert.equal(service.store.get(interrupted.id).result.nextStep, 1);
  await assert.rejects(
    service.browser.resume(service.store.get(interrupted.id)),
    /job_requires_manual_review_no_replay/,
  );
  service.browser.step = original;
  entry.lease = null;
  const cookiesBefore = await entry.context.cookies();
  assert.equal(
    cookiesBefore.find((c) => c.name === "testsession").value,
    "alive",
  );
  await entry.context.close();
  const reopened = await service.browser.open("workspace");

  assert.equal(
    (await reopened.context.cookies()).find((c) => c.name === "testsession")
      .value,
    "alive",
  );
  // An owned HTML drop target exercises real mouse events through the scaled
  // JPEG console; click-only forwarding cannot pass this assertion.
  const dragHtml = `<!doctype html><html><body>
    <div id="drag-source" draggable="true" style="position:fixed;left:120px;top:120px;width:120px;height:90px;background:#bcd">Drag me</div>
    <div id="drop-target" data-drops="0" style="position:fixed;left:430px;top:120px;width:180px;height:120px;background:#cdb">Drop here</div>
    <div id="slider-status" data-moves="0" data-held="0" style="position:fixed;left:120px;top:290px">Live slider: hold and move</div>
    <div id="live-knob" style="position:fixed;left:120px;top:330px;width:120px;height:70px;background:#ace">Hold me</div>
    <script>
      document.querySelector('#drag-source').ondragstart=e=>e.dataTransfer.setData('text/plain','owned-drag');
      const target=document.querySelector('#drop-target');
      target.ondragover=e=>e.preventDefault();
      target.ondrop=e=>{e.preventDefault();if(e.dataTransfer.getData('text/plain')==='owned-drag'){target.dataset.drops=String(Number(target.dataset.drops)+1);target.textContent='Drag delivered';}};
      const status=document.querySelector('#slider-status'),knob=document.querySelector('#live-knob');
      knob.onpointerdown=e=>{status.dataset.held='1';knob.setPointerCapture(e.pointerId);};
      knob.onpointermove=e=>{if(status.dataset.held==='1'){status.dataset.moves=String(Number(status.dataset.moves)+1);knob.style.left=Math.max(120,e.clientX-60)+'px';status.textContent='Moving while held';}};
      document.onpointerup=document.onpointercancel=()=>{status.dataset.held='0';};
    </script></body></html>`;
  await reopened.context.unroute("**/*");
  await reopened.context.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html", body: dragHtml }),
  );
  await reopened.page.goto("https://fixture.polza.test/");
  let expectedDrops = 0;
  // Desktop/phone exercise the actual served UI, including concurrent poll updates.
  const { chromium } = await import(
    "../../packages/client/node_modules/@playwright/test/index.mjs"
  );
  const ui = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 1000, height: 600 },
      { width: 375, height: 812 },
    ]) {
      const context = await ui.newContext({
        viewport,
        hasTouch: viewport.width < 500,
      });
      await context.addCookies([{ name: "who", value: "marker", url: origin }]);
      const page = await context.newPage();
      const errors = [];
      const gestures = [];
      page.on("request", (r) => {
        if (r.url().endsWith("/input")) gestures.push(r.postDataJSON()?.action);
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/media/`);

      await page
        .getByRole("heading", { name: "Медиабраузер", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Открыть экран" }).click();

      await page.locator("#viewer:not([hidden])").waitFor();
      await page
        .getByRole("button", { name: "Перехватить управление" })
        .click();
      await page
        .locator("#browser-state")
        .filter({ hasText: "Вы управляете" })
        .waitFor();
      const field = page.locator("#text");
      await field.focus();
      const typed = "Sequential input 123";
      let accumulated = "";
      for (const character of typed) {
        const start = performance.now();
        await field.pressSequentially(character);
        accumulated += character;
        assert.equal(await field.inputValue(), accumulated);
        assert.ok(
          performance.now() - start < 100,
          "Sequential key acknowledgement exceeded 100ms",
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.locator("#frame").scrollIntoViewIfNeeded();
      const bounds = await page.locator("#frame").boundingBox();
      const start = {
        x: bounds.x + (bounds.width * 180) / 1280,
        y: bounds.y + (bounds.height * 165) / 800,
      };
      const end = {
        x: bounds.x + (bounds.width * 520) / 1280,
        y: bounds.y + (bounds.height * 180) / 800,
      };
      await reopened.page.locator("#live-knob").evaluate((knob) => {
        knob.style.left = "120px";
        document.querySelector("#slider-status").dataset.moves = "0";
      });
      const liveStart = {
        x: bounds.x + (bounds.width * 180) / 1280,
        y: bounds.y + (bounds.height * 365) / 800,
      };
      const liveEnd = {
        x: bounds.x + (bounds.width * 400) / 1280,
        y: liveStart.y,
      };
      const touch =
        viewport.width < 500 ? await context.newCDPSession(page) : null;
      if (touch) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [liveStart],
        });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [liveEnd],
        });
      } else {
        await page.mouse.move(liveStart.x, liveStart.y);
        await page.mouse.down();
        await page.mouse.move(liveEnd.x, liveEnd.y, { steps: 10 });
      }
      // This assertion runs BEFORE the human mouse/touch release. Buffered
      // replay-after-release cannot pass a real slider interaction.
      await reopened.page.waitForFunction(
        () =>
          Number(document.querySelector("#slider-status").dataset.moves) > 0 &&
          document.querySelector("#slider-status").dataset.held === "1",
      );
      assert.equal(reopened.pointer?.actor, "marker");
      if (touch) {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await touch.detach();
      } else await page.mouse.up();
      await reopened.page.waitForFunction(
        () => document.querySelector("#slider-status").dataset.held === "0",
      );
      if (viewport.width < 500) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [start],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [end],
        });
        const cancellation = page.waitForResponse(
          (response) =>
            response.url().endsWith("/input") &&
            response.request().postDataJSON()?.action?.type ===
              "pointer_cancel",
        );
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: [],
        });
        assert.equal((await cancellation).ok(), true);
        assert.equal(
          reopened.pointer,
          null,
          "Cancellation must release the mouse",
        );
        assert.equal(
          await reopened.page
            .locator("#drop-target")
            .getAttribute("data-drops"),
          String(expectedDrops),
          "Cancellation must not complete a drop",
        );
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [start],
        });
        for (let i = 1; i <= 12; i++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              {
                x: start.x + ((end.x - start.x) * i) / 12,
                y: start.y + ((end.y - start.y) * i) / 12,
              },
            ],
          });
        }
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 12 });
        await page.mouse.up();
      }
      expectedDrops++;
      await reopened.page
        .waitForFunction(
          (count) =>
            document.querySelector("#drop-target").dataset.drops ===
            String(count),
          expectedDrops,
          { timeout: 10000 },
        )
        .catch(async (error) => {
          throw new Error(
            JSON.stringify({
              viewport,
              gestures,
              message: await page.locator("#message").textContent(),
              drops: await reopened.page
                .locator("#drop-target")
                .getAttribute("data-drops"),
            }),
            { cause: error },
          );
        });
      if (process.env.POLZA_MEDIA_CAPTURE_DIR) {
        const previousFrame = await page.locator("#frame").getAttribute("src");
        await page.waitForFunction(
          (previous) => document.getElementById("frame").src !== previous,
          previousFrame,
          { timeout: 5000 },
        );
        await page.locator("#frame").evaluate((image) => image.decode());
        await fs.mkdir(process.env.POLZA_MEDIA_CAPTURE_DIR, {
          recursive: true,
        });
        await page.screenshot({
          path: path.join(
            process.env.POLZA_MEDIA_CAPTURE_DIR,
            viewport.width === 1000 ? "desktop.png" : "phone.png",
          ),
        });
      }
      assert.deepEqual(errors, []);
      await page.getByRole("button", { name: "Отдать агенту" }).click();
      await page
        .locator("#browser-state")
        .filter({ hasText: "Управление свободно" })
        .waitFor();
      await context.close();
    }
  } finally {
    await ui.close();
  }
  for (const cleanup of ["takeover", "expiry"]) {
    const box = await reopened.page.locator("#live-knob").boundingBox();
    service.browser.lease(reopened, "marker", "held-pointer");
    await service.browser.input(reopened, "marker", "held-pointer", {
      type: "pointer_start",
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    assert.equal(
      await reopened.page.locator("#slider-status").getAttribute("data-held"),
      "1",
    );
    if (cleanup === "takeover") {
      service.browser.lease(reopened, "owner", "new-controller", true);
      await service.browser.serial(reopened, () => {});
      await assert.rejects(
        service.browser.input(reopened, "marker", "held-pointer", {
          type: "pointer_end",
          x: 200,
          y: 365,
        }),
        /control_lease_required/,
      );
    } else {
      reopened.lease.until = Date.now() - 1;
      await service.browser.sweep();
    }
    assert.equal(
      reopened.pointer,
      null,
      `${cleanup} must release a held pointer`,
    );
    assert.equal(
      await reopened.page.locator("#slider-status").getAttribute("data-held"),
      "0",
    );
    reopened.lease = null;
  }
  assert.equal((await request("/media/api/status")).status, 200);
});

test("vault login keeps secrets server-side and leaves verification to a human", {
  timeout: 30_000,
}, async (t) => {
  const { root, config, service } = await fixture(t);
  config.credentials = path.join(root, "accounts.json");
  const secret = "fixture-only-password-9283";
  await fs.writeFile(
    config.credentials,
    JSON.stringify({
      accounts: [
        {
          platform: "workspace.ru",
          login: "fixture@example.com",
          password: secret,
        },
      ],
    }),
  );
  const entry = await service.browser.open("workspace");
  await entry.context.unroute("**/*");
  await entry.context.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta charset="utf-8"><form><input name="email" type="email"><input type="password"><div class="smart-captcha" style="width:200px;height:60px">Fixture verification</div><button type="button" onclick="document.querySelector(\'p\').textContent=\'clicked\'">Войти</button><p>not clicked</p></form>',
    }),
  );
  await entry.page.goto("https://fixture.polza.test/");
  const result = await service.browser.login(entry, "marker");
  assert.equal(result.status, "waiting_for_human");
  assert.equal(
    await entry.page.locator("input[type=password]").inputValue(),
    secret,
  );
  assert.equal(
    await entry.page.locator("input[type=email]").inputValue(),
    "fixture@example.com",
  );
  assert.equal(await entry.page.locator("p").innerText(), "not clicked");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(
    JSON.stringify(await service.browser.status(entry)).includes(secret),
    false,
  );
  await entry.page.locator(".smart-captcha").evaluate((box) => box.remove());
  assert.equal(
    (await service.browser.login(entry, "marker")).status,
    "login_submitted_verify_snapshot",
  );
  assert.equal(await entry.page.locator("p").innerText(), "clicked");
  assert.equal(
    (await service.browser.login(entry, "marker")).status,
    "login_retry_limited",
  );
  // Real sites may render a registration form beside an unnamed Email login.
  // Only the uniquely named login form may receive the stored credential.
  await entry.page.setContent(
    '<input name="search"><form id="login"><input placeholder="Email"><input type="password"><button type="button">Войти</button></form><form id="signup"><input type="email"><input type="password"><input type="password"><button>Зарегистрироваться</button></form>',
  );
  const scoped = await service.browser.login(entry, "marker");
  assert.equal(scoped.status, "login_retry_limited");
  assert.equal(
    await entry.page.locator('#login input[placeholder="Email"]').inputValue(),
    "fixture@example.com",
  );
  assert.equal(
    await entry.page.locator('#login input[type="password"]').inputValue(),
    secret,
  );
  assert.deepEqual(
    await entry.page
      .locator('#signup input[type="password"]')
      .evaluateAll((nodes) => nodes.map((n) => n.value)),
    ["", ""],
  );
});
