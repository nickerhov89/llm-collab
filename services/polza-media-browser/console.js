const $ = (id) => document.getElementById(id);
const client = crypto.randomUUID();
let site = null;
let owned = false;
let stopped = false;
let frameUrl = null;
let refreshing = false;
let gesture = null;
let lastPointerUp = 0;
const errors = {
  login_required: "Сначала войдите в коворк на главной странице.",
  media_access_denied:
    "Для этого раздела нужен доступ владельца или маркетолога к SEO & PR.",
  browser_has_controller:
    "Управление уже у человека или агента. Можно перехватить его кнопкой выше.",
  control_lease_required:
    "Возьмите управление кнопкой «Перехватить управление».",
  close_another_browser_first:
    "Достигнут лимит открытых браузеров. Закройте текущий кабинет перед открытием следующего.",
  profile_busy_or_browser_unavailable:
    "Профиль уже занят другим процессом или Chromium недоступен. Не удаляйте профиль: обратитесь к администратору.",
  site_url_only: "Здесь можно открывать только страницы выбранной площадки.",
  operation_failed:
    "Не получилось выполнить действие. Обновите экран; если действие отправляло публикацию, сначала проверьте её статус на площадке.",
};
function message(text, error = false) {
  $("message").hidden = false;
  $("message").textContent = text;
  $("message").className = error ? "error" : "";
}
async function api(route, data, timeout) {
  const response = await fetch(`/media/api${route}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { "X-Yep-Anywhere": "true", "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(errors[result.error] || result.error || "Ошибка сервиса");
  return result;
}
const safely = (fn) => async (event) => {
  event?.preventDefault();
  try {
    await fn(event);
  } catch (error) {
    message(error.message, true);
  }
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
const statusLabels = {
  waiting_for_human: "Нужна проверка человеком",
  queued: "В очереди",
  running: "В работе",
  needs_review: "Нужна проверка",
  completed: "Шаги выполнены",
  cancelled: "Отменена",
};
async function refresh() {
  const data = await api("/status");
  $("browser-limit").textContent = data.maxBrowsers;
  $("actor").textContent = data.actor === "owner" ? "Владелец" : "Маркетолог";
  $("project").href = `/projects/${data.projectId}`;
  $("agent-command").textContent = `polza-media --actor ${data.actor} status`;
  $("sites").replaceChildren(
    ...data.sites.map((item) => {
      const card = element(
        "article",
        undefined,
        `site${site === item.id ? " active" : ""}`,
      );
      card.dataset.site = item.id;
      card.append(
        element("h2", item.name),
        element(
          "p",
          item.open
            ? item.controller
              ? `Управляет: ${item.controller}`
              : "Браузер открыт · управление свободно"
            : "Профиль на VPS · вход при открытии",
        ),
      );
      const button = element(
        "button",
        item.open ? "Открыть экран" : "Открыть кабинет",
        "secondary",
      );
      button.onclick = safely(async () => {
        button.disabled = true;
        button.textContent = "Открываем…";
        try {
          await release();
          await api(`/sites/${item.id}/open`, {});
          site = item.id;
          $("viewer").hidden = false;
          $("viewer-title").textContent = item.name;
          try {
            await claim(false);
          } catch (error) {
            message(error.message, true);
          }
          await snapshot();
          await frame();
          await refresh();
          $("viewer").scrollIntoView({ behavior: "smooth", block: "start" });
        } finally {
          button.disabled = false;
          button.textContent = "Открыть экран";
        }
      });
      card.append(button);
      return card;
    }),
  );
  const jobs = data.jobs.map((job) => {
    const row = element("article", undefined, "job");
    row.append(
      element("strong", job.title),
      element("span", statusLabels[job.status], "badge"),
      element(
        "p",
        `${job.site} · ${job.actor} · ${new Date(job.created).toLocaleString("ru")}`,
      ),
    );
    if (job.result?.reason)
      row.append(
        element(
          "p",
          job.result.reason === "interrupted_or_assertion_failed_no_replay"
            ? `Остановлено. Выполнено шагов: ${job.result.nextStep}. Проверьте кабинет перед повторной отправкой.`
            : job.result.reason,
        ),
      );
    if (job.result?.url && /^https:\/\//.test(job.result.url)) {
      const a = element("a", "Открыть результат ↗");
      a.href = job.result.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      row.append(a);
    }
    if (job.result?.evidence) {
      const a = element("a", "Скриншот проверки");
      a.href = `/media/api/jobs/${job.id}/evidence`;
      a.target = "_blank";
      a.rel = "noopener";
      row.append(a);
    }
    if (job.result?.handoffUrl) {
      const a = element("a", "Открыть ту же сессию для проверки");
      a.href = job.result.handoffUrl;
      a.target = "_blank";
      a.rel = "noopener";
      row.append(a);
    }
    if (job.status === "queued") {
      const button = element("button", "Отменить", "secondary");
      button.onclick = safely(async () => {
        await api(`/jobs/${job.id}/cancel`, {});
        await refresh();
      });
      row.append(button);
    }
    return row;
  });
  $("jobs").replaceChildren(
    ...(jobs.length
      ? jobs
      : [
          element(
            "p",
            "Очередь пуста. Можно открыть кабинет или передать агенту задачу.",
            "muted",
          ),
        ]),
  );
}
async function snapshot() {
  if (!site) return;
  const data = await api(`/sites/${site}/snapshot`);
  // Do not replace a URL while the user is typing it.
  if (document.activeElement !== $("url")) $("url").value = data.url;
  const auth = {
    challenge: "Нужна проверка площадки",
    login_required: "Нужен вход",
    unverified: "Статус входа проверьте в кабинете",
  };
  $("browser-state").textContent =
    `${auth[data.auth]} · ${owned ? "Вы управляете" : data.lease ? `Управляет: ${data.lease.actor}` : "Управление свободно"}`;
}
async function claim(takeover) {
  if (!site) return;
  await api(`/sites/${site}/lease`, { client, takeover });
  owned = true;
  if ($("message").classList.contains("error")) $("message").hidden = true;
  await snapshot();
}
async function release() {
  if (gesture) await finishGesture(gesture, true);
  if (site && owned) {
    try {
      await api(`/sites/${site}/release`, { client });
    } catch {
      /* Lease may already have expired or been taken over. */
    }
  }
  owned = false;
}
async function input(action) {
  if (!site || !owned) throw new Error(errors.control_lease_required);
  await api(`/sites/${site}/input`, { client, action });
  await frame();
}
async function frame() {
  if (!site || refreshing || stopped || document.hidden) return;
  refreshing = true;
  const current = site;
  try {
    const response = await fetch(`/media/api/sites/${site}/frame`);
    if (!response.ok) return;
    const blob = await response.blob();
    if (site !== current || stopped) return;
    const old = frameUrl;
    frameUrl = URL.createObjectURL(blob);
    $("frame").src = frameUrl;
    if (old) URL.revokeObjectURL(old);
  } finally {
    refreshing = false;
  }
}
$("refresh").onclick = safely(refresh);
$("takeover").onclick = safely(() => claim(true));
$("release").onclick = safely(async () => {
  await release();
  await snapshot();
  message(
    "Браузер свободен. Агент может продолжить новой задачей после проверки текущего состояния.",
  );
});
$("close").onclick = safely(async () => {
  await api(`/sites/${site}/close`, { client });
  site = null;
  owned = false;
  $("viewer").hidden = true;
  await refresh();
});
$("navigation").onsubmit = safely(() =>
  input({ type: "goto", url: $("url").value }),
);
$("typing").onsubmit = safely(async () => {
  const value = $("text").value;
  if (!value) return;
  await input({ type: "text", value });
  $("text").value = "";
  $("text").focus();
});
$("mask").onchange = () => {
  $("text").type = $("mask").checked ? "password" : "text";
};
function screenPoint(event) {
  const rect = $("frame").getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(1280, ((event.clientX - rect.left) / rect.width) * 1280),
    ),
    y: Math.max(
      0,
      Math.min(800, ((event.clientY - rect.top) / rect.height) * 800),
    ),
  };
}
async function pointerInput(current, action) {
  if (current.site !== site || !owned)
    throw new Error(errors.control_lease_required);
  await api(`/sites/${current.site}/input`, { client, action }, 15000);
}
function watchGesture(current) {
  current.pending.catch((error) => {
    if (!current.failed) message(error.message, true);
    current.failed = true;
  });
}
function flushGesture(current) {
  if (current.flushing) return current.pending;
  current.flushing = true;
  current.pending = current.pending
    .then(async () => {
      while (current.points.length && !current.cancelled) {
        const points = current.points.splice(0, 16);
        await pointerInput(current, { type: "pointer_move", points });
      }
    })
    .finally(() => {
      current.flushing = false;
    });
  watchGesture(current);
  return current.pending;
}
async function finishGesture(current, cancelled = false, point) {
  if (current.ending) return current.finished;
  current.ending = true;
  current.cancelled = cancelled;
  lastPointerUp = performance.now();
  current.finished = (async () => {
    try {
      if (cancelled) current.points.length = 0;
      else if (point) current.points.push(point);
      await flushGesture(current);
      await pointerInput(
        current,
        cancelled
          ? { type: "pointer_cancel" }
          : { type: "pointer_end", ...point },
      );
    } catch (error) {
      if (!current.failed) message(error.message, true);
      if (current.site === site && owned)
        await pointerInput(current, { type: "pointer_cancel" }).catch(() => {});
    } finally {
      if (gesture === current) gesture = null;
      lastPointerUp = performance.now();
      $("frame").classList.remove("dragging");
      await frame();
    }
  })();
  return current.finished;
}
$("frame").onpointerdown = safely((event) => {
  if (event.button !== 0 || gesture) return;
  if (!site || !owned) throw new Error(errors.control_lease_required);
  $("screen-control").focus({ preventScroll: true });
  $("frame").setPointerCapture(event.pointerId);
  gesture = {
    site,
    id: event.pointerId,
    points: [],
    pending: null,
    ending: false,
    cancelled: false,
  };
  gesture.pending = pointerInput(gesture, {
    type: "pointer_start",
    ...screenPoint(event),
  });
  watchGesture(gesture);
});
$("frame").onpointermove = (event) => {
  if (!gesture || gesture.ending || event.pointerId !== gesture.id) return;
  event.preventDefault();
  const point = screenPoint(event);
  $("frame").classList.add("dragging");
  if (gesture.points.length >= 32) gesture.points.shift();
  gesture.points.push(point);
  void flushGesture(gesture);
};
$("frame").onpointerup = safely(async (event) => {
  if (!gesture || event.pointerId !== gesture.id) return;
  await finishGesture(gesture, false, screenPoint(event));
});
$("frame").onpointercancel = $("frame").onlostpointercapture = (event) => {
  if (!gesture || gesture.ending || event.pointerId !== gesture.id) return;
  void finishGesture(gesture, true);
};
// Accessibility/browser-control clicks may arrive without pointer events.
$("frame").onclick = safely((event) => {
  if (gesture || performance.now() - lastPointerUp < 500) return;
  return input({ type: "click", ...screenPoint(event) });
});
$("screen-control").onkeydown = safely(async (event) => {
  if (
    ["Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp"].includes(
      event.key,
    )
  )
    return input({ type: "key", key: event.key });
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey)
    return input({ type: "text", value: event.key });
});
for (const button of document.querySelectorAll("[data-key]"))
  button.onclick = safely(() =>
    input({ type: "key", key: button.dataset.key }),
  );
$("up").onclick = safely(() => input({ type: "scroll", y: -600 }));
$("down").onclick = safely(() => input({ type: "scroll", y: 600 }));
$("connect").onclick = safely(async () => {
  const data = await api("/agents", {});
  $("agent-command").textContent =
    `${data.command}\nКлюч действует до ${new Date(data.expires).toLocaleDateString("ru")}`;
  message(
    "Ключ сохранён в закрытой конфигурации на VPS. Агент может использовать CLI из SEO-проекта.",
  );
});
$("revoke").onclick = safely(async () => {
  await api("/agents/revoke", {});
  message("Ключ отозван. Новые запросы агента будут отклонены.");
});
$("plan-form").onsubmit = safely(async () => {
  const result = await api("/jobs", JSON.parse($("plan").value));
  message(
    result.duplicate
      ? "Такая задача уже существует, дубль не создан."
      : "Задача поставлена в очередь.",
  );
  await refresh();
});
let cycles = 0;
const poll = async () => {
  if (stopped) return;
  try {
    if (!document.hidden) {
      await frame();
      cycles++;
      if (cycles % 6 === 0) {
        await refresh();
        await snapshot();
      }
      if (cycles % 12 === 0 && owned && site) {
        try {
          await api(`/sites/${site}/lease`, { client });
        } catch {
          owned = false;
          await snapshot();
        }
      }
    }
  } catch {
    /* A transient frame failure must not interrupt typing or flood alerts. */
  }
  if (!stopped) setTimeout(poll, 2000);
};
window.addEventListener("pagehide", () => {
  if (site && owned)
    void fetch(`/media/api/sites/${site}/release`, {
      method: "POST",
      headers: { "X-Yep-Anywhere": "true", "Content-Type": "application/json" },
      body: JSON.stringify({ client }),
      keepalive: true,
    }).catch(() => {});
  stopped = true;
  if (frameUrl) URL.revokeObjectURL(frameUrl);
});
await safely(refresh)();
const requestedSite = new URLSearchParams(location.search).get("site");
if (requestedSite)
  document
    .querySelector(`[data-site="${CSS.escape(requestedSite)}"] button`)
    ?.click();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void release();
});
void poll();

$("upload").onchange = safely(async () => {
  const file = $("upload").files[0];
  if (!file || !site || !owned) throw new Error(errors.control_lease_required);
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Максимальный размер файла — 15 МБ.");
  const response = await fetch(`/media/api/sites/${site}/file`, {
    method: "POST",
    headers: {
      "X-Yep-Anywhere": "true",
      "Content-Type": "application/octet-stream",
      "X-Media-Client": client,
      "X-Media-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error === "click_file_field_first"
        ? "Сначала нажмите на поле загрузки файла внутри кабинета."
        : result.error,
    );
  $("upload").value = "";
  message("Файл передан в кабинет. Проверьте его на экране перед сохранением.");
  await frame();
});
