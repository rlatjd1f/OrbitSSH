const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const pty = require("node-pty");

const isDev = !app.isPackaged;
const sessions = new Map();
let mainWindow;
let lastTerminalWrite;
let terminalStartCount = 0;
let terminalInterruptCount = 0;
let activeTerminalSessionId = null;
let physicalControlDown = false;
let lastPhysicalControlUpAt = 0;
let remappedControlCActive = false;
let availableUpdate = null;
let cachedUpdateResult = null;
let lastUpdateCheckAt = 0;

const updateRepository = "rlatjd1f/OrbitSSH";

function versionParts(value) {
  return String(value)
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number(part) || 0);
}

function isNewerVersion(latest, current) {
  const latestParts = versionParts(latest);
  const currentParts = versionParts(current);
  const length = Math.max(latestParts.length, currentParts.length, 3);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (latestParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

async function checkForUpdate(force = false) {
  const currentVersion = app.getVersion();
  if (process.env.ORBIT_UI_SELF_TEST === "1") {
    availableUpdate = {
      assetUrl: `https://github.com/rlatjd1f/OrbitSSH/releases/download/v0.2.0/OrbitSSH-0.2.0-${process.arch}.dmg`,
      assetName: `OrbitSSH-0.2.0-${process.arch}.dmg`,
      releaseUrl: "https://github.com/rlatjd1f/OrbitSSH/releases/tag/v0.2.0",
    };
    return {
      currentVersion,
      updateAvailable: true,
      latestVersion: "0.2.0",
      tagName: "v0.2.0",
      releaseName: "Orbit SSH v0.2.0",
      releaseNotes: "## 🚀 업데이트 내역\n\n- 업데이트 테스트",
      releaseUrl: availableUpdate.releaseUrl,
      assetName: availableUpdate.assetName,
      architecture: process.arch,
    };
  }
  if (
    !force &&
    cachedUpdateResult &&
    Date.now() - lastUpdateCheckAt < 5 * 60 * 1000
  )
    return cachedUpdateResult;

  const response = await net.fetch(
    `https://api.github.com/repos/${updateRepository}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `OrbitSSH/${currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `${mainText("GitHub 업데이트 확인 실패", "GitHub update check failed")} (${response.status})`,
    );

  const release = await response.json();
  const latestVersion = String(release.tag_name ?? "").replace(/^v/i, "");
  const updateAvailable = isNewerVersion(latestVersion, currentVersion);
  const assetName = `OrbitSSH-${latestVersion}-${process.arch}.dmg`;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item.name === assetName)
    : null;
  availableUpdate =
    updateAvailable && asset
      ? {
          assetUrl: asset.browser_download_url,
          assetName,
          releaseUrl: release.html_url,
        }
      : null;
  cachedUpdateResult = {
    currentVersion,
    updateAvailable,
    latestVersion,
    tagName: release.tag_name,
    releaseName: release.name || release.tag_name,
    releaseNotes: release.body || "",
    releaseUrl: release.html_url,
    assetName: asset?.name ?? null,
    architecture: process.arch,
  };
  lastUpdateCheckAt = Date.now();
  return cachedUpdateResult;
}

function downloadAvailableUpdate(sender) {
  if (!availableUpdate)
    throw new Error(
      mainText(
        "다운로드할 업데이트가 없습니다.",
        "There is no update available to download.",
      ),
    );
  const update = availableUpdate;
  const savePath = path.join(app.getPath("downloads"), update.assetName);
  return new Promise((resolve, reject) => {
    let started = false;
    let timeout;
    const onDownload = (_event, item) => {
      if (!item.getURLChain().includes(update.assetUrl)) return;
      started = true;
      clearTimeout(timeout);
      sender.session.removeListener("will-download", onDownload);
      item.setSavePath(savePath);
      send("update:status", {
        phase: "downloading",
        percent: 0,
        fileName: update.assetName,
      });
      item.on("updated", (_downloadEvent, state) => {
        if (state !== "progressing") return;
        const total = item.getTotalBytes();
        const received = item.getReceivedBytes();
        send("update:status", {
          phase: "downloading",
          percent: total > 0 ? Math.round((received / total) * 100) : 0,
          received,
          total,
          fileName: update.assetName,
        });
      });
      item.once("done", async (_downloadEvent, state) => {
        if (state !== "completed") {
          const error = new Error(
            mainText(
              `업데이트 다운로드가 ${state} 상태로 종료됐습니다.`,
              `The update download ended with status: ${state}.`,
            ),
          );
          send("update:status", { phase: "error", message: error.message });
          reject(error);
          return;
        }
        const openError = await shell.openPath(savePath);
        send("update:status", {
          phase: "completed",
          percent: 100,
          path: savePath,
          opened: !openError,
        });
        resolve({ path: savePath, opened: !openError, openError });
      });
    };
    sender.session.on("will-download", onDownload);
    timeout = setTimeout(() => {
      if (started) return;
      sender.session.removeListener("will-download", onDownload);
      reject(
        new Error(
          mainText(
            "업데이트 다운로드를 시작하지 못했습니다.",
            "The update download could not be started.",
          ),
        ),
      );
    }, 10000);
    try {
      sender.downloadURL(update.assetUrl);
    } catch (error) {
      clearTimeout(timeout);
      sender.session.removeListener("will-download", onDownload);
      reject(error);
    }
  });
}

const shortcutLogPath = () =>
  path.join(app.getPath("userData"), "shortcut-debug.log");

function logShortcut(event, details = {}) {
  try {
    const file = shortcutLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > 1024 * 1024) fs.truncateSync(file, 0);
    } catch {}
    fs.appendFileSync(
      file,
      `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`,
      { mode: 0o600 },
    );
  } catch {}
}

if (process.env.ORBIT_UI_SELF_TEST === "1") {
  const testStore = path.join(app.getPath("temp"), "orbit-ssh-ui-test");
  fs.rmSync(testStore, { recursive: true, force: true });
  app.setPath("userData", testStore);
}

const defaults = {
  groups: [{ id: "default", name: "Servers", parentId: null }],
  hosts: [],
};
const defaultSettings = {
  language: "ko",
  terminalFontSize: 12,
  terminalFontFamily: "JetBrains Mono, Menlo, monospace",
  terminalLineHeight: 1.45,
  cursorBlink: true,
  scrollback: 5000,
  defaultUser: "",
  defaultPort: 22,
  defaultAuthType: "key",
  keepAliveInterval: 30,
};
const storePath = () => path.join(app.getPath("userData"), "connections.json");
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
};

function loadSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return {
      ...defaultSettings,
      ...stored,
      language: stored.language === "en" ? "en" : "ko",
    };
  } catch {
    return { ...defaultSettings };
  }
}

function mainText(ko, en) {
  return loadSettings().language === "en" ? en : ko;
}

function saveSettings(value) {
  const clean = {
    language: value.language === "en" ? "en" : "ko",
    terminalFontSize: clamp(value.terminalFontSize, 9, 24, 12),
    terminalFontFamily:
      String(value.terminalFontFamily ?? "").trim().slice(0, 200) ||
      defaultSettings.terminalFontFamily,
    terminalLineHeight: clamp(value.terminalLineHeight, 1, 2, 1.45),
    cursorBlink: Boolean(value.cursorBlink),
    scrollback: clamp(value.scrollback, 1000, 50000, 5000),
    defaultUser: String(value.defaultUser ?? "").trim(),
    defaultPort: clamp(value.defaultPort, 1, 65535, 22),
    defaultAuthType: value.defaultAuthType === "password" ? "password" : "key",
    keepAliveInterval: clamp(value.keepAliveInterval, 0, 600, 30),
  };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(clean, null, 2), {
    mode: 0o600,
  });
  return clean;
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      hosts: Array.isArray(parsed.hosts) ? parsed.hosts : [],
    };
  } catch {
    return structuredClone(defaults);
  }
}

function saveStore(data) {
  const previous = loadStore();
  if (process.platform === "darwin") {
    for (const host of data.hosts) {
      if (
        host.authType === "password" &&
        typeof host.password === "string" &&
        host.password.length > 0
      ) {
        execFileSync(
          "/usr/bin/security",
          [
            "add-generic-password",
            "-U",
            "-s",
            "OrbitSSH",
            "-a",
            host.id,
            "-w",
            host.password,
          ],
          { stdio: "ignore" },
        );
      }
      if (host.authType === "key") {
        try {
          execFileSync(
            "/usr/bin/security",
            ["delete-generic-password", "-s", "OrbitSSH", "-a", host.id],
            { stdio: "ignore" },
          );
        } catch {}
      }
    }
    for (const old of previous.hosts) {
      if (!data.hosts.some((host) => host.id === old.id)) {
        try {
          execFileSync(
            "/usr/bin/security",
            ["delete-generic-password", "-s", "OrbitSSH", "-a", old.id],
            { stdio: "ignore" },
          );
        } catch {}
      }
    }
  }
  const clean = {
    groups: data.groups.map(({ id, name, parentId = null }) => ({
      id,
      name: String(name).trim(),
      parentId,
    })),
    hosts: data.hosts.map(
      ({
        id,
        name,
        host,
        user,
        port = 22,
        groupId,
        authType = "key",
        identityFile = "",
      }) => ({
        id,
        name: String(name).trim(),
        host: String(host).trim(),
        user: String(user).trim(),
        port: Number(port),
        groupId,
        authType: authType === "password" ? "password" : "key",
        identityFile: String(identityFile).trim(),
      }),
    ),
  };
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(clean, null, 2), {
    mode: 0o600,
  });
  return clean;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, payload);
}

function interruptActiveTerminal() {
  if (!activeTerminalSessionId) {
    logShortcut("interrupt:no-active-session");
    return false;
  }
  if (process.env.ORBIT_UI_SELF_TEST === "1") {
    lastTerminalWrite = {
      sessionId: activeTerminalSessionId,
      data: "\x03",
    };
    terminalInterruptCount += 1;
  }
  const proc = sessions.get(activeTerminalSessionId);
  if (!proc) {
    logShortcut("interrupt:session-not-running", {
      sessionId: activeTerminalSessionId,
    });
    return false;
  }
  proc.write("\x03");
  logShortcut("interrupt:sent", { sessionId: activeTerminalSessionId });
  return true;
}

function registerTerminalShortcut() {
  globalShortcut.unregister("Control+C");
  const registered = globalShortcut.register("Control+C", () => {
    logShortcut("global-shortcut:invoked", {
      focused: Boolean(mainWindow?.isFocused()),
    });
    interruptActiveTerminal();
  });
  logShortcut("global-shortcut:registered", { registered });
}

function unregisterTerminalShortcut() {
  globalShortcut.unregister("Control+C");
  logShortcut("global-shortcut:unregistered");
}

function startSession(host) {
  if (!host || !host.host || !host.user)
    throw new Error(
      mainText(
        "접속 정보가 올바르지 않습니다.",
        "The connection details are invalid.",
      ),
    );
  if (process.env.ORBIT_UI_SELF_TEST === "1") terminalStartCount += 1;
  const sessionId = crypto.randomUUID();
  const settings = loadSettings();
  const args = [
    "-tt",
    "-p",
    String(host.port || settings.defaultPort),
    "-o",
    `ServerAliveInterval=${settings.keepAliveInterval}`,
    "-o",
    "ServerAliveCountMax=3",
  ];
  let password = "";
  if (host.authType === "password") {
    args.push(
      "-o",
      "PreferredAuthentications=password,keyboard-interactive",
      "-o",
      "PubkeyAuthentication=no",
    );
    if (process.platform === "darwin") {
      try {
        password = execFileSync(
          "/usr/bin/security",
          ["find-generic-password", "-s", "OrbitSSH", "-a", host.id, "-w"],
          { encoding: "utf8" },
        ).trimEnd();
      } catch {}
    }
  } else if (host.identityFile) args.push("-i", host.identityFile);
  args.push(`${host.user}@${host.host}`);
  const proc = pty.spawn("/usr/bin/ssh", args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: app.getPath("home"),
    env: { ...process.env, TERM: "xterm-256color" },
  });
  sessions.set(sessionId, proc);
  let promptTail = "";
  let passwordAttempts = 0;
  proc.onData((data) => {
    send("terminal:data", { sessionId, data });
    if (password && passwordAttempts < 3) {
      promptTail = (promptTail + data)
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
        .slice(-300);
      if (/password:\s*$/i.test(promptTail)) {
        passwordAttempts += 1;
        promptTail = "";
        setTimeout(() => proc.write(`${password}\r`), 40);
      }
    }
  });
  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(sessionId);
    send("terminal:exit", { sessionId, exitCode, signal });
  });
  return sessionId;
}

function registerIpc() {
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("update:check", (_event, force) =>
    checkForUpdate(Boolean(force)),
  );
  ipcMain.handle("update:download", (event) =>
    downloadAvailableUpdate(event.sender),
  );
  ipcMain.handle("update:open-release", async () => {
    await shell.openExternal(
      availableUpdate?.releaseUrl ??
        cachedUpdateResult?.releaseUrl ??
        `https://github.com/${updateRepository}/releases/latest`,
    );
  });
  ipcMain.handle("store:load", () => loadStore());
  ipcMain.handle("store:save", (_event, data) => saveStore(data));
  ipcMain.handle("settings:load", () => loadSettings());
  ipcMain.handle("settings:save", (_event, value) => {
    const saved = saveSettings(value);
    installApplicationMenu(saved.language);
    return saved;
  });
  ipcMain.handle("terminal:start", (_event, host) => startSession(host));
  ipcMain.on("terminal:write", (_event, { sessionId, data }) => {
    if (process.env.ORBIT_UI_SELF_TEST === "1")
      lastTerminalWrite = { sessionId, data };
    sessions.get(sessionId)?.write(data);
  });
  ipcMain.on("terminal:set-active", (_event, sessionId) => {
    activeTerminalSessionId = sessionId || null;
    logShortcut("active-session:changed", {
      sessionId: activeTerminalSessionId,
      running: sessions.has(activeTerminalSessionId),
    });
  });
  ipcMain.on("terminal:resize", (_event, { sessionId, cols, rows }) => {
    if (cols > 0 && rows > 0) sessions.get(sessionId)?.resize(cols, rows);
  });
  ipcMain.on("shortcut:renderer-log", (_event, { event, details }) => {
    logShortcut(`renderer:${event}`, details);
  });
  ipcMain.handle("terminal:close", (_event, sessionId) => {
    const proc = sessions.get(sessionId);
    if (proc) {
      proc.kill();
      sessions.delete(sessionId);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: "Orbit SSH",
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.maximize();
  if (isDev)
    mainWindow.loadURL(
      process.env.ORBIT_DEV_URL || "http://127.0.0.1:5173",
    );
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const modifiers = input.modifiers ?? [];
    const isPhysicalControl =
      input.code === "ControlLeft" ||
      input.code === "ControlRight" ||
      key === "control";
    if (isPhysicalControl) {
      physicalControlDown = input.type === "keyDown";
      if (input.type === "keyUp") lastPhysicalControlUpAt = Date.now();
    }
    const reportedControl = input.control || modifiers.includes("control");
    const shortcutTargetKey =
      key === "c" ||
      key === "n" ||
      key === "t" ||
      key === "[" ||
      key === "]" ||
      input.code === "BracketLeft" ||
      input.code === "BracketRight";
    const recentPhysicalControl =
      shortcutTargetKey &&
      input.meta &&
      lastPhysicalControlUpAt > 0 &&
      Date.now() - lastPhysicalControlUpAt <= 250;
    if (key === "c" && input.type === "keyDown" && recentPhysicalControl)
      remappedControlCActive = true;
    const remappedControlC =
      key === "c" && input.meta && remappedControlCActive;
    const controlPressed =
      reportedControl ||
      physicalControlDown ||
      recentPhysicalControl ||
      remappedControlC;
    const remappedControlShortcut =
      input.meta && (recentPhysicalControl || remappedControlC);
    if (shortcutTargetKey || reportedControl || isPhysicalControl)
      logShortcut("before-input-event", {
        type: input.type,
        key: input.key,
        code: input.code,
        control: input.control,
        meta: input.meta,
        shift: input.shift,
        alt: input.alt,
        modifiers,
        physicalControlDown,
        recentPhysicalControl,
        remappedControlCActive,
        effectiveControl: controlPressed,
        remappedControlShortcut,
        activeSessionId: activeTerminalSessionId,
      });
    if (key === "w" && (input.meta || input.control)) {
      event.preventDefault();
      mainWindow.webContents.send("shortcut:action", "close-tab");
    } else if (
      key === "c" &&
      controlPressed &&
      (!input.meta || physicalControlDown || remappedControlC)
    ) {
      if (activeTerminalSessionId) {
        event.preventDefault();
        if (input.type === "keyDown") interruptActiveTerminal();
      }
    } else if (key === "d" && input.meta) {
      event.preventDefault();
      mainWindow.webContents.send("shortcut:action", "split-tab");
    } else if (
      input.type === "keyDown" &&
      key === "n" &&
      controlPressed &&
      (!input.meta || remappedControlShortcut)
    ) {
      event.preventDefault();
      logShortcut("shortcut:dispatch", { action: "open-session" });
      mainWindow.webContents.send("shortcut:action", "open-session");
    } else if (
      input.type === "keyDown" &&
      controlPressed &&
      (!input.meta || remappedControlShortcut) &&
      (key === "[" || input.code === "BracketLeft")
    ) {
      event.preventDefault();
      logShortcut("shortcut:dispatch", { action: "previous-pane" });
      mainWindow.webContents.send("shortcut:action", "previous-pane");
    } else if (
      input.type === "keyDown" &&
      controlPressed &&
      (!input.meta || remappedControlShortcut) &&
      (key === "]" || input.code === "BracketRight")
    ) {
      event.preventDefault();
      logShortcut("shortcut:dispatch", { action: "next-pane" });
      mainWindow.webContents.send("shortcut:action", "next-pane");
    } else if (
      input.type === "keyDown" &&
      key === "t" &&
      controlPressed &&
      (!input.meta || remappedControlShortcut)
    ) {
      event.preventDefault();
      logShortcut("shortcut:dispatch", { action: "duplicate-tab" });
      mainWindow.webContents.send("shortcut:action", "duplicate-tab");
    } else if (key === "," && (input.meta || input.control)) {
      event.preventDefault();
      mainWindow.webContents.send("shortcut:action", "open-settings");
    } else if (key === "tab" && input.control && !input.shift) {
      event.preventDefault();
      mainWindow.webContents.send("shortcut:action", "next-tab");
    }
    if (key === "c" && input.type === "keyUp")
      remappedControlCActive = false;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("focus", registerTerminalShortcut);
  mainWindow.on("blur", () => {
    physicalControlDown = false;
    lastPhysicalControlUpAt = 0;
    remappedControlCActive = false;
    unregisterTerminalShortcut();
  });
  mainWindow.on("closed", unregisterTerminalShortcut);
  registerTerminalShortcut();
}

function installApplicationMenu(language = loadSettings().language) {
  const ko = language !== "en";
  const menuText = ko
    ? {
        about: "Orbit SSH 정보",
        settings: "설정…",
        hide: "Orbit SSH 가리기",
        hideOthers: "다른 항목 가리기",
        showAll: "모두 보기",
        quit: "Orbit SSH 종료",
        terminal: "터미널",
        interrupt: "작업 중단",
        showLog: "단축키 디버그 로그 보기",
        edit: "편집",
        undo: "실행 취소",
        redo: "다시 실행",
        copy: "복사",
        paste: "붙여넣기",
        selectAll: "전체 선택",
        window: "윈도우",
        minimize: "최소화",
        zoom: "확대/축소",
      }
    : {
        about: "About Orbit SSH",
        settings: "Settings…",
        hide: "Hide Orbit SSH",
        hideOthers: "Hide Others",
        showAll: "Show All",
        quit: "Quit Orbit SSH",
        terminal: "Terminal",
        interrupt: "Interrupt",
        showLog: "Show Shortcut Debug Log",
        edit: "Edit",
        undo: "Undo",
        redo: "Redo",
        copy: "Copy",
        paste: "Paste",
        selectAll: "Select All",
        window: "Window",
        minimize: "Minimize",
        zoom: "Zoom",
      };
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about", label: menuText.about },
              {
                label: menuText.settings,
                accelerator: "Command+,",
                click: () => send("shortcut:action", "open-settings"),
              },
              { type: "separator" },
              { role: "hide", label: menuText.hide },
              { role: "hideOthers", label: menuText.hideOthers },
              { role: "unhide", label: menuText.showAll },
              { type: "separator" },
              { role: "quit", label: menuText.quit },
            ],
          },
        ]
      : []),
    {
      label: menuText.terminal,
      submenu: [
        {
          label: menuText.interrupt,
          sublabel: "Control+C",
          click: () => {
            logShortcut("menu:interrupt-clicked");
            interruptActiveTerminal();
          },
        },
        { type: "separator" },
        {
          label: menuText.showLog,
          click: () => {
            logShortcut("menu:show-log");
            shell.showItemInFolder(shortcutLogPath());
          },
        },
      ],
    },
    {
      label: menuText.edit,
      submenu: [
        { role: "undo", label: menuText.undo, accelerator: "Command+Z" },
        { role: "redo", label: menuText.redo, accelerator: "Command+Shift+Z" },
        { type: "separator" },
        {
          label: menuText.copy,
          accelerator: "Command+C",
          click: () => send("shortcut:action", "copy-selection"),
        },
        { role: "paste", label: menuText.paste, accelerator: "Command+V" },
        { role: "selectAll", label: menuText.selectAll, accelerator: "Command+A" },
      ],
    },
    {
      label: menuText.window,
      submenu: [
        { role: "minimize", label: menuText.minimize },
        { role: "zoom", label: menuText.zoom },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (process.env.ORBIT_PTY_SELF_TEST === "1") {
    const test = pty.spawn(
      "/bin/sh",
      ["-lc", "printf INTERRUPT_READY; sleep 10 && printf INTERRUPT_FAILED"],
      {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      env: process.env,
      },
    );
    let output = "";
    let interruptSent = false;
    test.onData((data) => {
      output += data;
      if (!interruptSent && output.includes("INTERRUPT_READY")) {
        interruptSent = true;
        test.write("\x03");
      }
    });
    test.onExit(() => {
      const passed =
        output.includes("INTERRUPT_READY") &&
        !output.includes("INTERRUPT_FAILED");
      console.log(
        passed ? "PTY Ctrl+C interrupt: OK" : "PTY Ctrl+C interrupt: FAIL",
      );
      app.exit(passed ? 0 : 1);
    });
    return;
  }
  if (process.env.ORBIT_UI_SELF_TEST === "1") {
    registerIpc();
    installApplicationMenu();
    saveStore({
      groups: [{ id: "test-group", name: "Test servers", parentId: null }],
      hosts: [
        {
          id: "test-host",
          name: "test-host",
          host: "127.0.0.1",
          user: "tester",
          port: 1,
          groupId: "test-group",
          authType: "key",
          identityFile: "",
        },
      ],
    });
    createWindow();
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
          const started=Date.now();
          const ready=()=>{
            if(document.querySelector('.app-shell')) return resolve(true);
            if(Date.now()-started>5000) return reject(new Error('UI mount timeout'));
            setTimeout(ready,25);
          };
          ready();
        })`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const settingsModifier =
          process.platform === "darwin" ? "meta" : "control";
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: ",",
          modifiers: [settingsModifier],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: ",",
          modifiers: [settingsModifier],
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const settingsCheck = await mainWindow.webContents
          .executeJavaScript(`(async()=>{
          const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
          const input=document.querySelector('[data-testid="default-user"]');
          const font=document.querySelector('[data-testid="terminal-font"]');
          const scrollback=document.querySelector('[data-testid="terminal-scrollback"]');
          const language=document.querySelector('[data-testid="language-select"]');
          const appVersion=document.querySelector('[data-testid="app-version"]');
          const updateResult=[...document.querySelectorAll('.update-result b')].find(el=>el.textContent.includes('v0.2.0'));
          const settingsOpened=Boolean(input&&font&&scrollback&&language);
          const defaultScrollback=scrollback?.value==='5000';
          const fontColor=font?getComputedStyle(font).color:'';
          const labelFontSize=font?parseFloat(getComputedStyle(font.closest('label')).fontSize):0;
          const sectionFontSize=parseFloat(getComputedStyle(document.querySelector('.settings-section h3')).fontSize);
          const setValue=async(el,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));await wait(30)};
          const setSelect=async(el,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));await wait(30)};
          let englishPreview=false;
          if(settingsOpened){await setValue(input,'global-test-user');await setSelect(font,'Menlo, Monaco, monospace');await setValue(scrollback,'7000');await setSelect(language,'en');englishPreview=document.querySelector('.settings-modal h2')?.textContent==='Settings'&&document.querySelector('[data-testid="default-user"]')?.getAttribute('aria-label')==='Default user';document.querySelector('.settings-modal .modal-actions .primary').click();await wait(100)}
          const englishAppUi=document.querySelector('[data-testid="new-folder"]')?.getAttribute('aria-label')==='New folder'&&document.querySelector('.add-connection')?.textContent.includes('New connection')&&document.querySelector('.empty h2')?.textContent==='No active sessions'&&document.querySelector('.update-toast span')?.textContent==='A new version is available.';
          document.querySelector('[data-testid="new-connection"]').click();await wait(30);
          const englishConnectionUi=document.querySelector('.modal h2')?.textContent==='New SSH connection'&&document.querySelector('[data-testid="device-name"]')?.getAttribute('aria-label')==='Device name'&&document.querySelector('.auth-options legend')?.textContent==='Authentication method';
          window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await wait(30);
          return {settingsOpened,englishPreview,englishAppUi,englishConnectionUi,appVersionVisible:appVersion?.textContent.includes('v0.1.0'),updateAvailableVisible:Boolean(updateResult),fontOptionCount:font?.options.length,defaultScrollback,fontColor,labelFontSize,sectionFontSize,settingsClosed:!document.querySelector('.settings-modal')};
        })()`);
        const englishMenuLabels = Menu.getApplicationMenu()?.items.flatMap(
          (item) => [
            item.label,
            ...(item.submenu?.items.map((child) => child.label) ?? []),
          ],
        );
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: ",",
          modifiers: [settingsModifier],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: ",",
          modifiers: [settingsModifier],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const languageReset = await mainWindow.webContents.executeJavaScript(`(async()=>{
          const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
          const language=document.querySelector('[data-testid="language-select"]');
          const englishSettingsOpened=document.querySelector('.settings-modal h2')?.textContent==='Settings'&&language?.value==='en';
          const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(language,'ko');language.dispatchEvent(new Event('change',{bubbles:true}));await wait(40);
          const koreanPreview=document.querySelector('.settings-modal h2')?.textContent==='설정';
          document.querySelector('.settings-modal .modal-actions .primary').click();await wait(100);
          return {englishSettingsOpened,koreanPreview,closed:!document.querySelector('.settings-modal')};
        })()`);
        const koreanMenuLabels = Menu.getApplicationMenu()?.items.flatMap(
          (item) => [
            item.label,
            ...(item.submenu?.items.map((child) => child.label) ?? []),
          ],
        );
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: ",",
          modifiers: [settingsModifier],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: ",",
          modifiers: [settingsModifier],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const settingsReopened = await mainWindow.webContents.executeJavaScript(
          `Boolean(document.querySelector('.settings-modal'))`,
        );
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Escape",
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const settingsEscapeClosed =
          settingsReopened &&
          (await mainWindow.webContents.executeJavaScript(
            `!document.querySelector('.settings-modal')`,
          ));
        const result = await mainWindow.webContents
          .executeJavaScript(`(async()=>{
          const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)); await wait(150);
          document.querySelector('[data-testid="new-folder"]').click(); await wait(20);
          const folderOpened=Boolean(document.querySelector('.modal'));
          window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); await wait(20);
          const escapeClosed=!document.querySelector('.modal');
          document.querySelector('[data-testid="new-connection"]').click(); await wait(20);
          const equipmentName=document.querySelector('[data-testid="device-name"]');
          const connectionHost=document.querySelector('[data-testid="connection-host"]');
          const connectionUser=document.querySelector('[data-testid="connection-user"]');
          const equipmentNameBlank=equipmentName?.value==='';
          const hostDefaultsToAny=connectionHost?.value==='0.0.0.0';
          const userBlank=connectionUser?.value==='';
          const placeholderColor=equipmentName?getComputedStyle(equipmentName,'::placeholder').color:'';
          const placeholderIsGray=placeholderColor==='rgb(111, 118, 133)';
          const equipmentLabel=equipmentName?.closest('label')?.textContent.trim().startsWith('장비 이름');
          document.querySelector('input[value="password"]').click(); await wait(20);
          const passwordVisible=Boolean(document.querySelector('input[type="password"]'));
          document.querySelector('input[value="key"]').click(); await wait(20);
          const keyVisible=Boolean(document.querySelector('input[placeholder="~/.ssh/id_ed25519"]'));
          window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); await wait(20);
          const host=[...document.querySelectorAll('.host-row')].find(el=>el.textContent.includes('test-host'));
          host.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await wait(150);
          host.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await wait(250);
          const terminalTabs=[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host'));
          const duplicateTabsOpened=terminalTabs.length===2;
          const activeBefore=terminalTabs.findIndex(el=>el.classList.contains('active'));
          window.__preservedPane=document.querySelector('.terminal-pane.focused');
          window.__preservedText=window.__preservedPane?.textContent??'';
          return {folderOpened,escapeClosed,passwordVisible,keyVisible,equipmentNameBlank,hostDefaultsToAny,userBlank,placeholderIsGray,equipmentLabel,duplicateTabsOpened,activeBefore};
        })()`);
        result.settingsShortcut =
          settingsCheck.settingsOpened && settingsCheck.settingsClosed;
        result.englishLanguagePreview = settingsCheck.englishPreview;
        result.englishAppUi = settingsCheck.englishAppUi;
        result.englishConnectionUi = settingsCheck.englishConnectionUi;
        result.englishMenu =
          englishMenuLabels?.includes("Terminal") &&
          englishMenuLabels?.includes("Edit") &&
          englishMenuLabels?.includes("Window") &&
          englishMenuLabels?.includes("Settings…") &&
          englishMenuLabels?.includes("Interrupt") &&
          englishMenuLabels?.includes("Copy");
        result.koreanLanguageRestored =
          languageReset.englishSettingsOpened &&
          languageReset.koreanPreview &&
          languageReset.closed;
        result.koreanMenu =
          koreanMenuLabels?.includes("터미널") &&
          koreanMenuLabels?.includes("편집") &&
          koreanMenuLabels?.includes("윈도우") &&
          koreanMenuLabels?.includes("설정…") &&
          koreanMenuLabels?.includes("작업 중단") &&
          koreanMenuLabels?.includes("복사");
        result.appVersionVisible = settingsCheck.appVersionVisible;
        result.updateAvailableVisible = settingsCheck.updateAvailableVisible;
        result.settingsEscapeClosed = settingsEscapeClosed;
        const persistedSettings = loadSettings();
        result.settingsPersisted =
          persistedSettings.defaultUser === "global-test-user" &&
          persistedSettings.language === "ko" &&
          persistedSettings.terminalFontFamily === "Menlo, Monaco, monospace" &&
          persistedSettings.scrollback === 7000;
        result.defaultScrollback = settingsCheck.defaultScrollback;
        result.fontComboHasTenOptions = settingsCheck.fontOptionCount === 10;
        result.settingsSelectReadable =
          settingsCheck.fontColor !== "rgb(0, 0, 0)";
        result.settingsLabelsLarger =
          settingsCheck.labelFontSize >= 12 &&
          settingsCheck.sectionFontSize >= 13;
        result.footerReadable = await mainWindow.webContents.executeJavaScript(
          `(()=>{const footer=document.querySelector('.workspace footer');if(!footer)return false;const style=getComputedStyle(footer);return parseFloat(style.fontSize)>=10&&style.color!=='rgb(97, 104, 119)'&&style.backgroundColor!=='rgb(18, 21, 27)'})()`,
        );
        await mainWindow.webContents.executeJavaScript(
          `(()=>document.querySelector('.terminal-pane.focused textarea')?.focus())()`,
        );
        const startsBeforeEnter = terminalStartCount;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Enter",
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Enter",
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        result.enterReconnectsSamePane =
          terminalStartCount === startsBeforeEnter + 1 &&
          (await mainWindow.webContents.executeJavaScript(
            `(()=>[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host')).length===2)()`,
          ));
        lastTerminalWrite = undefined;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "C",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "C",
          modifiers: ["control"],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        result.ctrlCSentToTerminal = lastTerminalWrite?.data === "\x03";
        lastTerminalWrite = undefined;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Control",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "C",
          modifiers: ["meta"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "C",
          modifiers: ["meta"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Control",
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        result.remappedCtrlCSentToTerminal =
          lastTerminalWrite?.data === "\x03";
        lastTerminalWrite = undefined;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Control",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Control",
        });
        await new Promise((resolve) => setTimeout(resolve, 16));
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "C",
          modifiers: ["meta"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "C",
          modifiers: ["meta"],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        result.releasedCtrlRemapSentToTerminal =
          lastTerminalWrite?.data === "\x03";
        const interruptsBeforeRepeat = terminalInterruptCount;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Control",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Control",
        });
        await new Promise((resolve) => setTimeout(resolve, 16));
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "C",
          modifiers: ["meta"],
        });
        for (let index = 0; index < 3; index += 1)
          mainWindow.webContents.sendInputEvent({
            type: "keyDown",
            keyCode: "C",
            modifiers: ["meta"],
            isAutoRepeat: true,
          });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "C",
          modifiers: ["meta"],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        result.heldCtrlCRepeated =
          terminalInterruptCount - interruptsBeforeRepeat === 4;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Tab",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Tab",
          modifiers: ["control"],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        result.ctrlTabMoved = await mainWindow.webContents.executeJavaScript(
          `(()=>[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host')).findIndex(el=>el.classList.contains('active'))===0)()`,
        );
        result.ctrlTabFocusedTerminal =
          await mainWindow.webContents.executeJavaScript(
            `(()=>document.activeElement===document.querySelector('.terminal-pane.focused textarea'))()`,
          );
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Tab",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Tab",
          modifiers: ["control"],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        result.tabContentPreserved =
          await mainWindow.webContents.executeJavaScript(
            `(()=>window.__preservedPane?.isConnected&&window.__preservedPane===document.querySelector('.terminal-pane.focused')&&(window.__preservedPane.textContent??'').length>=window.__preservedText.length)()`,
          );
        const closeModifier =
          process.platform === "darwin" ? "meta" : "control";
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "W",
          modifiers: [closeModifier],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "W",
          modifiers: [closeModifier],
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        result.closeShortcut = await mainWindow.webContents.executeJavaScript(
          `(()=>[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host')).length===1)()`,
        );
        result.windowRemainedOpen = !mainWindow.isDestroyed();
        const splitLayouts = [];
        for (let index = 0; index < 3; index += 1) {
          mainWindow.webContents.sendInputEvent({
            type: "keyDown",
            keyCode: "D",
            modifiers: ["meta"],
          });
          mainWindow.webContents.sendInputEvent({
            type: "keyUp",
            keyCode: "D",
            modifiers: ["meta"],
          });
          await new Promise((resolve) => setTimeout(resolve, 120));
          splitLayouts.push(
            await mainWindow.webContents.executeJavaScript(
              `(()=>document.querySelector('.split-grid')?.className??'')()`,
            ),
          );
        }
        result.splitLayouts = splitLayouts;
        result.fourPaneGrid =
          splitLayouts[0].includes("panes-2") &&
          splitLayouts[1].includes("panes-3") &&
          splitLayouts[2].includes("panes-4");
        const gridGeometry = await mainWindow.webContents.executeJavaScript(
          `(()=>{const grid=document.querySelector('.split-grid');const panes=[...document.querySelectorAll('.terminal-pane:not(.cached)')];const rects=panes.map(p=>p.getBoundingClientRect());const gridRect=grid.getBoundingClientRect();return {twoColumns:new Set(rects.map(r=>Math.round(r.left))).size===2,twoRows:new Set(rects.map(r=>Math.round(r.top))).size===2,inside:rects.every(r=>r.bottom<=gridRect.bottom+1),topTabs:[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host')).length}})()`,
        );
        result.gridGeometry = gridGeometry;
        result.trueTwoByTwo =
          gridGeometry.twoColumns && gridGeometry.twoRows && gridGeometry.inside;
        result.splitDoesNotAddTabs = gridGeometry.topTabs === 1;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "D",
          modifiers: ["meta"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "D",
          modifiers: ["meta"],
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        result.maxFour = await mainWindow.webContents.executeJavaScript(
          `(()=>document.querySelectorAll('.terminal-pane').length===4)()`,
        );
        const focusedPaneBeforeCycle =
          await mainWindow.webContents.executeJavaScript(
            `(()=>[...document.querySelectorAll('.terminal-pane:not(.cached)')].findIndex(el=>el.classList.contains('focused')))()`,
          );
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "[",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "[",
          modifiers: ["control"],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const focusedPaneAfterPrevious =
          await mainWindow.webContents.executeJavaScript(
            `(()=>[...document.querySelectorAll('.terminal-pane:not(.cached)')].findIndex(el=>el.classList.contains('focused')))()`,
          );
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "]",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "]",
          modifiers: ["control"],
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const focusedPaneAfterNext =
          await mainWindow.webContents.executeJavaScript(
            `(()=>[...document.querySelectorAll('.terminal-pane:not(.cached)')].findIndex(el=>el.classList.contains('focused')))()`,
          );
        result.ctrlBracketMovesPane =
          focusedPaneBeforeCycle === 3 &&
          focusedPaneAfterPrevious === 2 &&
          focusedPaneAfterNext === 3;
        result.ctrlBracketFocusedTerminal =
          await mainWindow.webContents.executeJavaScript(
            `(()=>document.activeElement===document.querySelector('.terminal-pane.focused textarea'))()`,
          );
        const remainingPaneCounts = [];
        for (let index = 0; index < 2; index += 1) {
          mainWindow.webContents.sendInputEvent({
            type: "keyDown",
            keyCode: "W",
            modifiers: [closeModifier],
          });
          mainWindow.webContents.sendInputEvent({
            type: "keyUp",
            keyCode: "W",
            modifiers: [closeModifier],
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
          remainingPaneCounts.push(
            await mainWindow.webContents.executeJavaScript(
              `(()=>document.querySelectorAll('.terminal-pane:not(.cached)').length)()`,
            ),
          );
        }
        result.splitCloseOneByOne =
          remainingPaneCounts[0] === 3 && remainingPaneCounts[1] === 2;
        result.topTabRemainsAfterPaneClose =
          await mainWindow.webContents.executeJavaScript(
            `(()=>[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host')).length===1)()`,
          );
        const startsBeforeDuplicate = terminalStartCount;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "T",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "T",
          modifiers: ["control"],
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        result.ctrlTOpensDuplicateTab =
          terminalStartCount === startsBeforeDuplicate + 1 &&
          (await mainWindow.webContents.executeJavaScript(
            `(()=>{const tabs=[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host'));return tabs.length===2&&tabs[1].classList.contains('active')&&document.querySelectorAll('.terminal-pane:not(.cached)').length===1})()`,
          ));
        const startsBeforeRemappedDuplicate = terminalStartCount;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Control",
          modifiers: ["control"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Control",
        });
        await new Promise((resolve) => setTimeout(resolve, 16));
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "T",
          modifiers: ["meta"],
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "T",
          modifiers: ["meta"],
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        result.remappedCtrlTOpensDuplicateTab =
          terminalStartCount === startsBeforeRemappedDuplicate + 1 &&
          (await mainWindow.webContents.executeJavaScript(
            `(()=>{const tabs=[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host'));return tabs.length===3&&tabs[2].classList.contains('active')&&document.querySelectorAll('.terminal-pane:not(.cached)').length===1})()`,
          ));
        const openSessionPicker = async () => {
          mainWindow.webContents.sendInputEvent({
            type: "keyDown",
            keyCode: "N",
            modifiers: ["control"],
          });
          mainWindow.webContents.sendInputEvent({
            type: "keyUp",
            keyCode: "N",
            modifiers: ["control"],
          });
          await new Promise((resolve) => setTimeout(resolve, 120));
        };
        const sessionTabsCount = () =>
          mainWindow.webContents.executeJavaScript(
            `(()=>[...document.querySelectorAll('.tabs button')].filter(el=>el.textContent.includes('test-host')).length)()`,
          );
        await openSessionPicker();
        const sessionPickerOpened =
          await mainWindow.webContents.executeJavaScript(
            `(()=>document.querySelector('.session-picker h2')?.textContent==='새 세션'&&document.querySelectorAll('[data-testid="session-picker-host"]').length===1)()`,
          );
        const startsBeforeSessionButton = terminalStartCount;
        await mainWindow.webContents.executeJavaScript(
          `(()=>document.querySelector('[data-testid="session-picker-open"]')?.click())()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        result.ctrlNOpenButtonStartsSession =
          sessionPickerOpened &&
          terminalStartCount === startsBeforeSessionButton + 1 &&
          (await sessionTabsCount()) === 4;
        await openSessionPicker();
        const startsBeforeSessionEnter = terminalStartCount;
        mainWindow.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Enter",
        });
        mainWindow.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Enter",
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        result.ctrlNEnterStartsSession =
          terminalStartCount === startsBeforeSessionEnter + 1 &&
          (await sessionTabsCount()) === 5;
        await openSessionPicker();
        const startsBeforeSessionDoubleClick = terminalStartCount;
        await mainWindow.webContents.executeJavaScript(
          `(()=>{const host=document.querySelector('[data-testid="session-picker-host"]');host?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        result.ctrlNDoubleClickStartsSession =
          terminalStartCount === startsBeforeSessionDoubleClick + 1 &&
          (await sessionTabsCount()) === 6;
        const passed =
          result.settingsShortcut &&
          result.englishLanguagePreview &&
          result.englishAppUi &&
          result.englishConnectionUi &&
          result.englishMenu &&
          result.koreanLanguageRestored &&
          result.koreanMenu &&
          result.appVersionVisible &&
          result.updateAvailableVisible &&
          result.settingsEscapeClosed &&
          result.settingsPersisted &&
          result.defaultScrollback &&
          result.fontComboHasTenOptions &&
          result.settingsSelectReadable &&
          result.settingsLabelsLarger &&
          result.footerReadable &&
          result.enterReconnectsSamePane &&
          result.ctrlCSentToTerminal &&
          result.remappedCtrlCSentToTerminal &&
          result.releasedCtrlRemapSentToTerminal &&
          result.heldCtrlCRepeated &&
          result.tabContentPreserved &&
          result.folderOpened &&
          result.escapeClosed &&
          result.passwordVisible &&
          result.keyVisible &&
          result.equipmentNameBlank &&
          result.hostDefaultsToAny &&
          result.userBlank &&
          result.placeholderIsGray &&
          result.equipmentLabel &&
          result.duplicateTabsOpened &&
          result.activeBefore === 1 &&
          result.ctrlTabMoved &&
          result.ctrlTabFocusedTerminal &&
          result.closeShortcut &&
          result.windowRemainedOpen &&
          result.fourPaneGrid &&
          result.trueTwoByTwo &&
          result.splitDoesNotAddTabs &&
          result.maxFour &&
          result.ctrlBracketMovesPane &&
          result.ctrlBracketFocusedTerminal &&
          result.splitCloseOneByOne &&
          result.topTabRemainsAfterPaneClose &&
          result.ctrlTOpensDuplicateTab &&
          result.remappedCtrlTOpensDuplicateTab &&
          result.ctrlNOpenButtonStartsSession &&
          result.ctrlNEnterStartsSession &&
          result.ctrlNDoubleClickStartsSession;
        console.log(
          `UI integration: ${passed ? "OK" : "FAIL"} ${JSON.stringify(result)}`,
        );
        app.exit(passed ? 0 : 1);
      } catch (error) {
        console.error("UI integration: FAIL", error);
        app.exit(1);
      }
    });
    return;
  }
  registerIpc();
  installApplicationMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  for (const proc of sessions.values()) proc.kill();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
