# Команды для Сергея

Сервер управления PolzaPortal: `144.31.54.166`.
`139.60.162.12` — исторический адрес; не использовать.
Выполнить от root через имеющийся у Сергея доступ. Docker, Signals и существующий
туннель cloudflared не трогать.

## 1. Разблокировать агентов и нормальный лимит процессов

Коворк сейчас сообщает `missing-bubblewrap`. Сам браузер работает без этого
пакета; пакет нужен для штатной песочницы ограниченного пользователя `marker`.
У manager также обнаружен мягкий лимит 200 и жёсткий 300 потоков на UID.
Без root сервис поднят до разрешённых 300, использует лёгкий headless-shell,
держит максимум один браузер. Для устойчивой работы с агентами нужен больший
лимит. Готовый скрипт не перезапускает user-manager, ботов, Docker или туннель.

```sh
cat /home/manager/services/polza-media-browser/setup-root.sh
bash /home/manager/services/polza-media-browser/setup-root.sh
```

Последняя команда должна завершиться с кодом 0. Если AppArmor запрещает
user namespaces, посмотреть `journalctl -k --since '-5 min' | grep -Ei 'apparmor|bwrap'`
и разрешить именно профиль установленного `/usr/bin/bwrap` по политике сервера.
Не отключать AppArmor и ограничения user namespaces глобально.

Обновить экран возможностей коворка (`/api/version?fresh=1`) и запустить
тестовый чат от `marker` внутри SEO & PR. Проверить не только наличие бинарника,
но и реальное создание песочницы и доступ CLI к HTTPS-адресу медиасервиса.

## 2. Оконный Chromium, если площадка не принимает headless

Это дополнительный режим, не условие работы экрана медиабраузера.

```sh
apt-get install -y xvfb
```

Затем от `manager`:

```sh
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/polza-media-display.service <<'UNIT'
[Unit]
Description=Private virtual display for Polza media Chromium
[Service]
ExecStart=/usr/bin/Xvfb :97 -screen 0 1280x800x24 -nolisten tcp -noreset
Restart=on-failure
NoNewPrivileges=true
UMask=0077
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now polza-media-display.service
printf '\nDISPLAY=:97\nMEDIA_HEADLESS=false\n' >> ~/.config/polza-media-browser.env
sed -i 's@MEDIA_CHROMIUM=.*@MEDIA_CHROMIUM=/home/manager/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome@' ~/.config/polza-media-browser.env
systemctl --user restart polza-media-browser.service
```

Сначала освободить браузеры и проверить задачи: перезапуск остановит выполняемые
шаги, а автоматического повторного размещения нет. CDP, VNC, порт 9222 и X11
не выставлять наружу: экран идёт через авторизованный HTTPS коворка.

## Граница текущей изоляции

Браузер, коворк и профили сейчас работают от доверенного оператора `manager`.
Ограниченный пользователь коворка — не отдельный Unix-пользователь; штатная
песочница ограничивает записи, но не обещает конфиденциальность файлов этого UID.
Для недоверенных агентов следующий инфраструктурный этап — отдельный Unix UID
браузерного worker, собственные профили и закрытое хранилище ключей, выдача
минимальных actor-scoped capabilities и сетевой egress-фильтр. Это нельзя заменить
`chmod 600` внутри одного UID. Текущая версия предназначена владельцу и уже
допущенному к медиадоступам маркетологу.
