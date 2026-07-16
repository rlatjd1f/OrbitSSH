import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  ChevronDown,
  ChevronRight,
  Command,
  Download,
  Ellipsis,
  ExternalLink,
  Folder,
  FolderPlus,
  KeyRound,
  LayoutGrid,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Server,
  Settings,
  TerminalSquare,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./features.css";
import { translate, type AppLanguage, type MessageKey } from "./i18n";

type SessionState = "connecting" | "connected" | "closed" | "error";
type Session = {
  tabId: string;
  workspaceId: string;
  hostId: string;
  kind: TerminalStartKind;
  sessionId?: string;
  state: SessionState;
};
type SidebarMenu = { hostId: string; x: number; y: number } | null;
type SessionHostView = Pick<
  ConnectionHost,
  "id" | "name" | "host" | "user" | "port"
> & { kind: TerminalStartKind };
type SessionPickerItem =
  | { id: typeof LOCAL_HOST_ID; kind: "local" }
  | { id: string; kind: "ssh"; host: ConnectionHost; group: ConnectionGroup };
const LOCAL_HOST_ID = "__orbit-local-terminal__";
const emptyStore: ConnectionStore = { groups: [], hosts: [] };
const defaultSettings: AppSettings = {
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
const colors = ["#ff7a59", "#49c6a1", "#5ea0ff", "#ae8cff"];
let activeTerminalInstance: Terminal | null = null;
const terminalFonts = [
  ["JetBrains Mono", "JetBrains Mono, Menlo, monospace"],
  ["Menlo", "Menlo, Monaco, monospace"],
  ["SF Mono", "SFMono-Regular, Consolas, monospace"],
  ["Monaco", "Monaco, Menlo, monospace"],
  ["Fira Code", "Fira Code, monospace"],
  ["D2Coding", "D2Coding, monospace"],
  ["Source Code Pro", "Source Code Pro, monospace"],
  ["IBM Plex Mono", "IBM Plex Mono, monospace"],
  ["Cascadia Code", "Cascadia Code, monospace"],
  ["system", "ui-monospace, SFMono-Regular, monospace"],
] as const;

function TerminalPane({
  session,
  settings,
  language,
  active,
  onState,
  onReconnect,
}: {
  session: Session;
  settings: AppSettings;
  language: AppLanguage;
  active: boolean;
  onState: (state: SessionState) => void;
  onReconnect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionRef = useRef(session);
  const onStateRef = useRef(onState);
  const onReconnectRef = useRef(onReconnect);
  const languageRef = useRef(language);
  sessionRef.current = session;
  onStateRef.current = onState;
  onReconnectRef.current = onReconnect;
  languageRef.current = language;
  useEffect(() => {
    if (!ref.current || !window.desktop) return;
    const term = new Terminal({
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      fontFamily: settings.terminalFontFamily,
      fontSize: settings.terminalFontSize,
      lineHeight: settings.terminalLineHeight,
      theme: {
        background: "#0e1015",
        foreground: "#c2c7d1",
        cursor: "#9ba3b2",
        black: "#0e1015",
        green: "#49c69d",
        brightGreen: "#69d8b4",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    term.attachCustomKeyEventHandler((event) => {
      if (event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "c") {
        const selection = term.getSelection();
        if (selection) window.desktop?.clipboard.writeText(selection);
        event.preventDefault();
        return false;
      }
      if (
        event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (
          event.type === "keydown" &&
          !event.repeat &&
          sessionRef.current.sessionId
        )
          window.desktop?.terminal.write(
            sessionRef.current.sessionId,
            "\x03",
          );
        return false;
      }
      return true;
    });
    const activate = () => {
      void window.desktop?.inputSource.useEnglish();
      window.desktop?.terminal.setActive(
        sessionRef.current.sessionId ?? null,
      );
    };
    ref.current.addEventListener("pointerdown", activate);
    const selection = term.onSelectionChange(() => {
      const value = term.getSelection();
      if (value) window.desktop?.clipboard.writeText(value);
    });
    fit.fit();
    terminalRef.current = term;
    let resizeFrame = 0;
    let lastCols = 0;
    let lastRows = 0;
    const onResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        fit.fit();
        if (
          sessionRef.current.sessionId &&
          (term.cols !== lastCols || term.rows !== lastRows)
        ) {
          lastCols = term.cols;
          lastRows = term.rows;
          window.desktop?.terminal.resize(
            sessionRef.current.sessionId,
            term.cols,
            term.rows,
          );
        }
      });
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(ref.current);
    const input = term.onData((data) => {
      const current = sessionRef.current;
      if (
        (current.state === "closed" || current.state === "error") &&
        (data === "\r" || data === "\n")
      ) {
        term.writeln(`\r\n\x1b[90m[${translate(languageRef.current, "reconnecting")}]\x1b[0m`);
        onReconnectRef.current();
        return;
      }
      if (current.sessionId)
        window.desktop?.terminal.write(current.sessionId, data);
    });
    const dataOff = window.desktop.terminal.onData((v) => {
      if (v.sessionId === sessionRef.current.sessionId) term.write(v.data);
    });
    const exitOff = window.desktop.terminal.onExit((v) => {
      if (v.sessionId === sessionRef.current.sessionId) {
        term.writeln(
          `\r\n\x1b[90m[${translate(languageRef.current, "connectionEnded", { code: v.exitCode })}]\r\n[${translate(languageRef.current, "pressEnterReconnect")}]\x1b[0m`,
        );
        onStateRef.current(v.exitCode === 0 ? "closed" : "error");
      }
    });
    if (!sessionRef.current.sessionId)
      term.writeln(`\x1b[90m${translate(languageRef.current, "connecting")}\x1b[0m`);
    else {
      onResize();
      void window.desktop?.inputSource.useEnglish();
      term.focus();
    }
    return () => {
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      input.dispose();
      selection.dispose();
      ref.current?.removeEventListener("pointerdown", activate);
      dataOff();
      exitOff();
      term.dispose();
      terminalRef.current = null;
    };
  }, [session.tabId]);
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = settings.terminalFontFamily;
    term.options.fontSize = settings.terminalFontSize;
    term.options.lineHeight = settings.terminalLineHeight;
    term.options.cursorBlink = settings.cursorBlink;
    term.options.scrollback = settings.scrollback;
  }, [settings]);
  useEffect(() => {
    if (active) {
      activeTerminalInstance = terminalRef.current;
      void window.desktop?.inputSource.useEnglish();
      window.desktop?.terminal.setActive(session.sessionId ?? null);
      const focusFrame = requestAnimationFrame(() => {
        terminalRef.current?.focus();
      });
      return () => cancelAnimationFrame(focusFrame);
    } else if (activeTerminalInstance === terminalRef.current) {
      activeTerminalInstance = null;
    }
  }, [active, session.sessionId]);
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !session.sessionId) return;
    void window.desktop?.inputSource.useEnglish();
    term.focus();
    window.desktop?.terminal.resize(session.sessionId, term.cols, term.rows);
  }, [session.sessionId]);
  return <div className="xterm-host" ref={ref} />;
}

function SettingsForm({
  value,
  appVersion,
  architecture,
  updateInfo,
  updateStatus,
  updateError,
  onChange,
  onSubmit,
  onCancel,
  onCheckUpdates,
  onDownloadUpdate,
  onOpenRelease,
}: {
  value: AppSettings;
  appVersion: string;
  architecture: string;
  updateInfo: UpdateInfo | null;
  updateStatus: UpdateStatus;
  updateError: string;
  onChange: (value: AppSettings) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onCheckUpdates: () => void;
  onDownloadUpdate: () => void;
  onOpenRelease: () => void;
}) {
  const language = value.language;
  const [activeSection, setActiveSection] = useState<
    "general" | "terminal" | "defaults" | "ssh" | "updates"
  >("general");
  const t = (key: MessageKey, values?: Record<string, string | number>) =>
    translate(language, key, values);
  const update = <K extends keyof AppSettings>(key: K, next: AppSettings[K]) =>
    onChange({ ...value, [key]: next });
  const isDownloading = updateStatus.phase === "downloading";
  const downloadPercent = Math.max(
    0,
    Math.min(100, Math.round(updateStatus.percent ?? 0)),
  );
  const hasDownloadTotal = Boolean(updateStatus.total && updateStatus.total > 0);
  const sectionButtons = [
    { id: "general", label: t("general"), icon: Settings },
    { id: "terminal", label: t("terminal"), icon: TerminalSquare },
    { id: "defaults", label: t("connectionDefaults"), icon: Server },
    { id: "ssh", label: t("sshConnection"), icon: LockKeyhole },
    { id: "updates", label: t("appUpdate"), icon: Download },
  ] as const;
  return (
    <form onSubmit={onSubmit}>
      <h2>{t("settings")}</h2>
      <p>{t("settingsDescription")}</p>
      <div className="settings-layout">
        <aside className="settings-nav" aria-label={t("settings")}>
          {sectionButtons.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={activeSection === id ? "active" : ""}
              data-testid={`settings-nav-${id}`}
              onClick={() => setActiveSection(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </aside>
        <div className="settings-content">
          {activeSection === "general" && (
            <section className="settings-section">
              <h3>{t("general")}</h3>
              <div className="settings-grid">
                <label className="settings-wide">
                  {t("language")}
                  <select
                    data-testid="language-select"
                    aria-label={t("language")}
                    value={value.language}
                    onChange={(event) =>
                      update("language", event.target.value as AppLanguage)
                    }
                  >
                    <option value="ko">{t("korean")}</option>
                    <option value="en">{t("english")}</option>
                  </select>
                </label>
              </div>
            </section>
          )}
          {activeSection === "terminal" && (
            <section className="settings-section">
              <h3>{t("terminal")}</h3>
              <div className="settings-grid">
                <label className="settings-wide">
                  {t("terminalFont")}
                  <select
                    data-testid="terminal-font"
                    aria-label={t("terminalFont")}
                    value={value.terminalFontFamily}
                    onChange={(event) =>
                      update("terminalFontFamily", event.target.value)
                    }
                    style={{ fontFamily: value.terminalFontFamily }}
                  >
                    {!terminalFonts.some(
                      ([, font]) => font === value.terminalFontFamily,
                    ) && (
                      <option value={value.terminalFontFamily}>
                        {t("currentSetting")}
                      </option>
                    )}
                    {terminalFonts.map(([label, font]) => (
                      <option key={label} value={font}>
                        {label === "system" ? t("systemMonospace") : label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("fontSize")}
                  <input
                    data-testid="terminal-font-size"
                    aria-label={t("fontSize")}
                    type="number"
                    min="9"
                    max="24"
                    value={value.terminalFontSize}
                    onChange={(e) =>
                      update("terminalFontSize", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  {t("lineHeight")}
                  <select
                    data-testid="terminal-line-height"
                    aria-label={t("lineHeight")}
                    value={value.terminalLineHeight}
                    onChange={(e) =>
                      update("terminalLineHeight", Number(e.target.value))
                    }
                  >
                    <option value="1.2">{t("compact")}</option>
                    <option value="1.45">{t("normal")}</option>
                    <option value="1.7">{t("spacious")}</option>
                  </select>
                </label>
                <label>
                  {t("scrollback")}
                  <input
                    data-testid="terminal-scrollback"
                    aria-label={t("scrollback")}
                    type="number"
                    min="1000"
                    max="50000"
                    step="1000"
                    value={value.scrollback}
                    onChange={(e) => update("scrollback", Number(e.target.value))}
                  />
                </label>
                <label className="setting-toggle">
                  <span>
                    <b>{t("cursorBlink")}</b>
                    <small>{t("cursorBlinkDescription")}</small>
                  </span>
                  <input
                    aria-label={t("cursorBlink")}
                    type="checkbox"
                    checked={value.cursorBlink}
                    onChange={(e) => update("cursorBlink", e.target.checked)}
                  />
                </label>
              </div>
            </section>
          )}
          {activeSection === "defaults" && (
            <section className="settings-section">
              <h3>{t("connectionDefaults")}</h3>
              <div className="settings-grid">
                <label>
                  {t("defaultUser")}
                  <input
                    data-testid="default-user"
                    aria-label={t("defaultUser")}
                    value={value.defaultUser}
                    onChange={(e) => update("defaultUser", e.target.value)}
                    placeholder="ubuntu"
                  />
                </label>
                <label>
                  {t("defaultPort")}
                  <input
                    aria-label={t("defaultPort")}
                    type="number"
                    min="1"
                    max="65535"
                    value={value.defaultPort}
                    onChange={(e) => update("defaultPort", Number(e.target.value))}
                  />
                </label>
                <label>
                  {t("defaultAuth")}
                  <select
                    aria-label={t("defaultAuth")}
                    value={value.defaultAuthType}
                    onChange={(e) =>
                      update(
                        "defaultAuthType",
                        e.target.value as "password" | "key",
                      )
                    }
                  >
                    <option value="key">{t("sshKey")}</option>
                    <option value="password">{t("password")}</option>
                  </select>
                </label>
              </div>
            </section>
          )}
          {activeSection === "ssh" && (
            <section className="settings-section">
              <h3>{t("sshConnection")}</h3>
              <div className="settings-grid">
                <label>
                  {t("keepAlive")}
                  <input
                    aria-label={t("keepAlive")}
                    type="number"
                    min="0"
                    max="600"
                    value={value.keepAliveInterval}
                    onChange={(e) =>
                      update("keepAliveInterval", Number(e.target.value))
                    }
                  />
                </label>
              </div>
            </section>
          )}
          {activeSection === "updates" && (
            <section className="settings-section update-section">
              <h3>{t("appUpdate")}</h3>
              <div className="update-card">
                <div>
                  <b data-testid="app-version">Orbit SSH v{appVersion || "-"}</b>
                  <small>
                    {t("installedVersion", {
                      architecture:
                        architecture === "arm64"
                          ? "Apple Silicon"
                          : architecture === "x64"
                            ? "Intel Mac"
                            : architecture,
                    })}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label={t("checkUpdate")}
                  onClick={onCheckUpdates}
                  disabled={
                    updateStatus.phase === "checking" ||
                    updateStatus.phase === "downloading"
                  }
                >
                  <RotateCw
                    className={updateStatus.phase === "checking" ? "spinning" : ""}
                  />
                  {updateStatus.phase === "checking"
                    ? t("checking")
                    : t("checkUpdate")}
                </button>
              </div>
              {updateInfo?.updateAvailable ? (
                <div className="update-result available">
                  <div>
                    <b>
                      {t("updateAvailable", {
                        version: updateInfo.latestVersion,
                      })}
                    </b>
                    <small>
                      {updateInfo.assetName
                        ? t("compatibleDmg", {
                            architecture:
                              architecture === "arm64"
                                ? "Apple Silicon"
                                : "Intel Mac",
                          })
                        : t("noCompatibleDmg")}
                    </small>
                  </div>
                  <div className="update-actions">
                    <button type="button" onClick={onOpenRelease}>
                      <ExternalLink /> {t("releaseNotes")}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={onDownloadUpdate}
                      disabled={
                        !updateInfo.assetName ||
                        updateStatus.phase === "downloading"
                      }
                    >
                      <Download />{" "}
                      {isDownloading ? t("downloadingUpdate") : t("downloadDmg")}
                    </button>
                  </div>
                </div>
              ) : updateInfo ? (
                <p className="update-message">{t("latestVersion")}</p>
              ) : null}
              {isDownloading && (
                <div className="update-progress-card" data-testid="update-progress-card">
                  <div className="update-progress-header">
                    <b>{t("downloadingUpdate")}</b>
                    <span>{downloadPercent}%</span>
                  </div>
                  <div
                    className={`update-progress ${hasDownloadTotal ? "" : "indeterminate"}`}
                    aria-label={t("downloadProgress")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={downloadPercent}
                    role="progressbar"
                  >
                    <span
                      style={{
                        width: hasDownloadTotal ? `${downloadPercent}%` : "42%",
                      }}
                    />
                  </div>
                </div>
              )}
              {updateStatus.phase === "completed" && (
                <p className="update-message success">{t("dmgOpened")}</p>
              )}
              {updateError && <p className="update-message error">{updateError}</p>}
            </section>
          )}
        </div>
      </div>
      <div className="modal-actions"><button type="button" onClick={onCancel}>{t("cancel")}</button><button className="primary">{t("saveSettings")}</button></div>
    </form>
  );
}

function App() {
  const [store, setStore] = useState<ConnectionStore>(emptyStore);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedHostId, setSelectedHostId] = useState("");
  const [activeTabId, setActiveTabId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<
    "host" | "group" | "settings" | "session" | null
  >(null);
  const [sessionPickerHostId, setSessionPickerHostId] = useState("");
  const [sidebarMenu, setSidebarMenu] = useState<SidebarMenu>(null);
  const defaultLocalOpened = useRef(false);
  const [editing, setEditing] = useState<ConnectionHost | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] =
    useState<AppSettings>(defaultSettings);
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    phase: "idle",
  });
  const [updateError, setUpdateError] = useState("");
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [form, setForm] = useState({
    name: "",
    host: "0.0.0.0",
    user: "",
    port: "22",
    groupId: "",
    authType: "key" as "password" | "key",
    identityFile: "",
    password: "",
  });
  const language = settings.language;
  const t = (key: MessageKey, values?: Record<string, string | number>) =>
    translate(language, key, values);
  const stateLabel = (state: SessionState) =>
    t(
      ({
        connecting: "stateConnecting",
        connected: "stateConnected",
        closed: "stateClosed",
        error: "stateError",
      } as const)[state],
    );
  const activeSession = sessions.find((s) => s.tabId === activeTabId);
  const activeWorkspaceId = activeSession?.workspaceId;
  const getSessionHost = (session?: Session): SessionHostView | undefined => {
    if (!session) return undefined;
    if (session.kind === "local")
      return {
        id: LOCAL_HOST_ID,
        name: t("localTerminal"),
        host: t("localMachine"),
        user: window.desktop?.platform === "darwin" ? "macOS" : "local",
        port: 0,
        kind: "local",
      };
    const host = store.hosts.find((h) => h.id === session.hostId);
    return host ? { ...host, kind: "ssh" } : undefined;
  };
  const selectedHost = store.hosts.find((h) => h.id === selectedHostId);
  const activeHost = activeSession
    ? getSessionHost(activeSession)
    : selectedHost
      ? { ...selectedHost, kind: "ssh" as const }
      : undefined;
  const visibleSessions = activeWorkspaceId
    ? sessions.filter((session) => session.workspaceId === activeWorkspaceId)
    : [];
  const workspaceTabs = sessions.filter(
    (session, index, all) =>
      all.findIndex((item) => item.workspaceId === session.workspaceId) ===
      index,
  );
  const sessionPickerHosts = store.groups.flatMap((group) =>
    store.hosts
      .filter((host) => host.groupId === group.id)
      .map((host) => ({ host, group })),
  );
  const sessionPickerItems: SessionPickerItem[] = [
    { id: LOCAL_HOST_ID, kind: "local" },
    ...sessionPickerHosts.map(({ host, group }) => ({
      id: host.id,
      kind: "ssh" as const,
      host,
      group,
    })),
  ];
  const moveSessionPickerSelection = (direction: -1 | 1) => {
    if (!sessionPickerItems.length) return;
    const index = sessionPickerItems.findIndex(
      (item) => item.id === sessionPickerHostId,
    );
    const next =
      sessionPickerItems[
        (index + direction + sessionPickerItems.length) %
          sessionPickerItems.length
      ];
    setSessionPickerHostId(next.id);
  };

  useEffect(() => {
    if (!window.desktop) return;
    Promise.all([
      window.desktop.store.load(),
      window.desktop.settings.load(),
      window.desktop.app.getVersion(),
    ]).then(([data, globalSettings, version]) => {
      setStore(data);
      setSettings(globalSettings);
      setSettingsDraft(globalSettings);
      setAppVersion(version);
      setExpanded(new Set(data.groups.map((g) => g.id)));
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded || !window.desktop) return;
    let active = true;
    const off = window.desktop.updates.onStatus((status) => {
      if (!active) return;
      setUpdateStatus(status);
      if (status.phase === "error")
        setUpdateError(status.message ?? t("updateDownloadFailed"));
    });
    setUpdateStatus({ phase: "checking" });
    window.desktop.updates
      .check(false)
      .then((info) => {
        if (!active) return;
        setUpdateInfo(info);
        setUpdateStatus({ phase: "idle" });
      })
      .catch(() => {
        if (active) setUpdateStatus({ phase: "idle" });
      });
    return () => {
      active = false;
      off();
    };
  }, [loaded, language]);
  const checkUpdates = async () => {
    setUpdateError("");
    setUpdateStatus({ phase: "checking" });
    try {
      const info = await window.desktop!.updates.check(true);
      setUpdateInfo(info);
      setUpdateDismissed(false);
      setUpdateStatus({ phase: "idle" });
    } catch (error) {
      setUpdateStatus({ phase: "error" });
      setUpdateError(
        error instanceof Error ? error.message : t("updateCheckFailed"),
      );
    }
  };
  const downloadUpdate = async () => {
    setUpdateError("");
    setUpdateStatus({ phase: "downloading", percent: 0 });
    try {
      await window.desktop!.updates.download();
    } catch (error) {
      setUpdateStatus({ phase: "error" });
      setUpdateError(
        error instanceof Error ? error.message : t("updateDownloadFailed"),
      );
    }
  };
  useEffect(() => {
    if (!dialog) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDialog(null);
      }
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [dialog]);
  useEffect(() => {
    if (dialog !== "session" || !sessionPickerHostId) return;
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector<HTMLButtonElement>(
        `[data-session-host-id="${CSS.escape(sessionPickerHostId)}"]`,
      );
      element?.focus();
      element?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [dialog, sessionPickerHostId]);
  useEffect(() => {
    if (!sidebarMenu) return;
    const close = () => setSidebarMenu(null);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [sidebarMenu]);
  const persist = async (next: ConnectionStore) => {
    const saved = await window.desktop!.store.save(next);
    setStore(saved);
    return saved;
  };
  const openSettings = () => {
    setSettingsDraft(settings);
    setDialog("settings");
  };
  const openSessionPicker = () => {
    setSessionPickerHostId(LOCAL_HOST_ID);
    setDialog("session");
  };
  const openPickedSession = (item?: SessionPickerItem) => {
    if (!item) return;
    setDialog(null);
    if (item.kind === "local") void openLocalTerminal();
    else void connect(item.host);
  };
  const openHostDialog = (host?: ConnectionHost) => {
    setEditing(host ?? null);
    setForm(
      host
        ? {
            name: host.name,
            host: host.host,
            user: host.user,
            port: String(host.port),
            groupId: host.groupId,
            authType: host.authType ?? "key",
            identityFile: host.identityFile ?? "",
            password: "",
          }
        : {
            name: "",
            host: "0.0.0.0",
            user: "",
            port: String(settings.defaultPort),
            groupId: store.groups[0]?.id ?? "",
            authType: settings.defaultAuthType,
            identityFile: "",
            password: "",
          },
    );
    setDialog("host");
  };
  const submitHost = async (e: FormEvent) => {
    e.preventDefault();
    const value: ConnectionHost = {
      id: editing?.id ?? crypto.randomUUID(),
      name: form.name.trim(),
      host: form.host.trim(),
      user: form.user.trim(),
      port: Number(form.port) || 22,
      groupId: form.groupId,
      authType: form.authType,
      identityFile: form.authType === "key" ? form.identityFile.trim() : "",
      ...(form.password ? { password: form.password } : {}),
    };
    if (
      !value.name ||
      !value.host ||
      !value.user ||
      !value.groupId ||
      (!editing && value.authType === "password" && !value.password)
    )
      return;
    await persist({
      ...store,
      hosts: editing
        ? store.hosts.map((h) => (h.id === editing.id ? value : h))
        : [...store.hosts, value],
    });
    setExpanded((x) => new Set(x).add(value.groupId));
    setDialog(null);
  };
  const submitGroup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const group = { id: crypto.randomUUID(), name, parentId: null };
    await persist({ ...store, groups: [...store.groups, group] });
    setExpanded((x) => new Set(x).add(group.id));
    setDialog(null);
  };
  const submitSettings = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await window.desktop!.settings.save(settingsDraft);
    setSettings(saved);
    setSettingsDraft(saved);
    setDialog(null);
  };
  const removeHost = async (host: ConnectionHost) => {
    if (!confirm(t("deleteHostConfirm", { name: host.name }))) return;
    const targets = sessions.filter((s) => s.hostId === host.id);
    await Promise.all(
      targets.map((s) =>
        s.sessionId
          ? window.desktop?.terminal.close(s.sessionId)
          : Promise.resolve(),
      ),
    );
    setSessions((x) => x.filter((s) => s.hostId !== host.id));
    if (targets.some((s) => s.tabId === activeTabId)) setActiveTabId("");
    if (selectedHostId === host.id) setSelectedHostId("");
    await persist({
      ...store,
      hosts: store.hosts.filter((h) => h.id !== host.id),
    });
  };
  const uniqueDuplicatedHostName = (name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped} \\((\\d+)\\)$`);
    const used = new Set(
      store.hosts
        .map((host) => {
          if (host.name === name) return 0;
          const match = host.name.match(pattern);
          return match ? Number(match[1]) : null;
        })
        .filter((value): value is number => value !== null),
    );
    let index = 1;
    while (used.has(index)) index += 1;
    return `${name} (${index})`;
  };
  const duplicateHost = async (host: ConnectionHost) => {
    const duplicated: ConnectionHost = {
      ...host,
      id: crypto.randomUUID(),
      name: uniqueDuplicatedHostName(host.name),
    };
    await persist({ ...store, hosts: [...store.hosts, duplicated] });
    setExpanded((current) => new Set(current).add(duplicated.groupId));
    setSelectedHostId(duplicated.id);
  };
  const removeSelectedSidebarHost = () => {
    const focusedHostId =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.sidebarHostId
        : "";
    const host = visibleSidebarHosts.find(
      (item) => item.id === (focusedHostId || selectedHostId),
    );
    if (!host) return;
    void removeHost(host);
  };
  const removeGroup = async (group: ConnectionGroup) => {
    if (store.hosts.some((h) => h.groupId === group.id)) {
      alert(t("groupNotEmpty"));
      return;
    }
    if (confirm(t("deleteGroupConfirm", { name: group.name })))
      await persist({
        ...store,
        groups: store.groups.filter((g) => g.id !== group.id),
      });
  };
  const connect = async (host: ConnectionHost, asSplit = false) => {
    const currentPanes = activeWorkspaceId
      ? sessions.filter((session) => session.workspaceId === activeWorkspaceId)
      : [];
    if (asSplit && (!activeWorkspaceId || currentPanes.length >= 4)) return;
    const tabId = crypto.randomUUID();
    const workspaceId = asSplit ? activeWorkspaceId! : tabId;
    setSelectedHostId(host.id);
    setActiveTabId(tabId);
    setSessions((x) => [
      ...x,
      { tabId, workspaceId, hostId: host.id, kind: "ssh", state: "connecting" },
    ]);
    try {
      const sessionId = await window.desktop!.terminal.start(host);
      setSessions((x) =>
        x.map((s) =>
          s.tabId === tabId ? { ...s, sessionId, state: "connected" } : s,
        ),
      );
    } catch {
      setSessions((x) =>
        x.map((s) => (s.tabId === tabId ? { ...s, state: "error" } : s)),
      );
    }
  };
  const openLocalTerminal = async (asSplit = false) => {
    const currentPanes = activeWorkspaceId
      ? sessions.filter((session) => session.workspaceId === activeWorkspaceId)
      : [];
    if (asSplit && (!activeWorkspaceId || currentPanes.length >= 4)) return;
    const tabId = crypto.randomUUID();
    const workspaceId = asSplit ? activeWorkspaceId! : tabId;
    setSelectedHostId("");
    setActiveTabId(tabId);
    setSessions((x) => [
      ...x,
      {
        tabId,
        workspaceId,
        hostId: LOCAL_HOST_ID,
        kind: "local",
        state: "connecting",
      },
    ]);
    try {
      const sessionId = await window.desktop!.terminal.startLocal();
      setSessions((x) =>
        x.map((s) =>
          s.tabId === tabId ? { ...s, sessionId, state: "connected" } : s,
        ),
      );
    } catch {
      setSessions((x) =>
        x.map((s) => (s.tabId === tabId ? { ...s, state: "error" } : s)),
      );
    }
  };
  const reconnectPane = async (tabId: string) => {
    const pane = sessions.find((session) => session.tabId === tabId);
    if (!pane || !["closed", "error"].includes(pane.state)) return;
    if (pane.kind === "local") {
      setSessions((current) =>
        current.map((session) =>
          session.tabId === tabId
            ? { ...session, sessionId: undefined, state: "connecting" }
            : session,
        ),
      );
      try {
        const sessionId = await window.desktop!.terminal.startLocal();
        setSessions((current) =>
          current.map((session) =>
            session.tabId === tabId
              ? { ...session, sessionId, state: "connected" }
              : session,
          ),
        );
      } catch {
        setSessions((current) =>
          current.map((session) =>
            session.tabId === tabId ? { ...session, state: "error" } : session,
          ),
        );
      }
      return;
    }
    const host = store.hosts.find((item) => item.id === pane.hostId);
    if (!host) return;
    setSessions((current) =>
      current.map((session) =>
        session.tabId === tabId
          ? { ...session, sessionId: undefined, state: "connecting" }
          : session,
      ),
    );
    try {
      const sessionId = await window.desktop!.terminal.start(host);
      setSessions((current) =>
        current.map((session) =>
          session.tabId === tabId
            ? { ...session, sessionId, state: "connected" }
            : session,
        ),
      );
    } catch {
      setSessions((current) =>
        current.map((session) =>
          session.tabId === tabId ? { ...session, state: "error" } : session,
        ),
      );
    }
  };
  const focusPane = (direction: -1 | 1) => {
    if (!visibleSessions.length || !activeTabId) return;
    const index = visibleSessions.findIndex(
      (session) => session.tabId === activeTabId,
    );
    const next =
      visibleSessions[
        (index + direction + visibleSessions.length) % visibleSessions.length
      ];
    if (!next) return;
    setActiveTabId(next.tabId);
    setSelectedHostId(next.kind === "ssh" ? next.hostId : "");
  };
  const closePane = async (tabId: string) => {
    const index = sessions.findIndex((v) => v.tabId === tabId);
    const session = sessions[index];
    if (session?.sessionId)
      await window.desktop?.terminal.close(session.sessionId);
    const remaining = sessions.filter((v) => v.tabId !== tabId);
    setSessions(remaining);
    if (activeTabId === tabId) {
      const splitNext = remaining.find(
        (v) => v.workspaceId === session?.workspaceId,
      );
      const roots = remaining.filter(
        (item, rootIndex, all) =>
          all.findIndex((other) => other.workspaceId === item.workspaceId) ===
          rootIndex,
      );
      const next =
        splitNext ??
        roots[Math.min(Math.max(index, 0), roots.length - 1)];
      setActiveTabId(next?.tabId ?? "");
      if (next) setSelectedHostId(next.kind === "ssh" ? next.hostId : "");
    }
  };
  const closeWorkspace = async (workspaceId: string) => {
    const targets = sessions.filter(
      (session) => session.workspaceId === workspaceId,
    );
    await Promise.all(
      targets.map((session) =>
        session.sessionId
          ? window.desktop?.terminal.close(session.sessionId)
          : Promise.resolve(),
      ),
    );
    const remaining = sessions.filter(
      (session) => session.workspaceId !== workspaceId,
    );
    setSessions(remaining);
    if (activeWorkspaceId === workspaceId) {
      const roots = remaining.filter(
        (item, index, all) =>
          all.findIndex((other) => other.workspaceId === item.workspaceId) ===
          index,
      );
      const closedIndex = workspaceTabs.findIndex(
        (tab) => tab.workspaceId === workspaceId,
      );
      const next = roots[Math.min(Math.max(closedIndex, 0), roots.length - 1)];
    setActiveTabId(next?.tabId ?? "");
      if (next) setSelectedHostId(next.kind === "ssh" ? next.hostId : "");
    }
  };
  const setSessionState = (tabId: string, state: SessionState) =>
    setSessions((x) => x.map((s) => (s.tabId === tabId ? { ...s, state } : s)));
  useEffect(() => {
    if (!loaded || defaultLocalOpened.current || sessions.length > 0) return;
    defaultLocalOpened.current = true;
    void openLocalTerminal();
  }, [loaded, sessions.length]);
  useEffect(
    () =>
      window.desktop?.onShortcut((action) => {
        if (action === "open-settings") {
          openSettings();
          return;
        }
        if (action === "copy-selection") {
          const selection = activeTerminalInstance?.getSelection();
          if (selection) window.desktop?.clipboard.writeText(selection);
          return;
        }
        if (action === "open-session") {
          openSessionPicker();
          return;
        }
        if (action === "close-tab") {
          if (visibleSessions.length > 1 && activeTabId) {
            void closePane(activeTabId);
          } else if (activeWorkspaceId) {
            void closeWorkspace(activeWorkspaceId);
          }
          return;
        }
        if (action === "split-tab") {
          if (activeSession && visibleSessions.length < 4) {
            if (activeSession.kind === "local") void openLocalTerminal(true);
            else {
              const host = store.hosts.find((h) => h.id === activeSession.hostId);
              if (host) void connect(host, true);
            }
          }
          return;
        }
        if (action === "previous-pane") {
          focusPane(-1);
          return;
        }
        if (action === "next-pane") {
          focusPane(1);
          return;
        }
        if (action === "duplicate-tab") {
          window.desktop?.debug?.logShortcut("duplicate-tab:received", {
            activeTabId,
            activeWorkspaceId,
            activeHostId: activeSession?.hostId ?? null,
            visiblePaneCount: visibleSessions.length,
            workspaceTabCount: workspaceTabs.length,
          });
          if (activeSession) {
            const host =
              activeSession.kind === "ssh"
                ? store.hosts.find((h) => h.id === activeSession.hostId)
                : undefined;
            window.desktop?.debug?.logShortcut("duplicate-tab:host", {
              found: activeSession.kind === "local" || Boolean(host),
              hostId: activeSession.hostId,
              hostName:
                activeSession.kind === "local" ? "local" : host?.name ?? null,
            });
            if (activeSession.kind === "local") void openLocalTerminal();
            else if (host) void connect(host);
          }
          return;
        }
        if (action === "next-tab" && workspaceTabs.length) {
          const index = workspaceTabs.findIndex(
            (s) => s.workspaceId === activeWorkspaceId,
          );
          const next =
            workspaceTabs[
              (index + 1 + workspaceTabs.length) % workspaceTabs.length
          ];
          setActiveTabId(next.tabId);
          setSelectedHostId(next.kind === "ssh" ? next.hostId : "");
        }
      }),
    [sessions, activeTabId, store, settings, loaded],
  );
  const groups = useMemo(
    () =>
      store.groups
        .map((g) => ({
          ...g,
          hosts: store.hosts.filter(
            (h) =>
              h.groupId === g.id &&
              `${h.name} ${h.host}`.toLowerCase().includes(query.toLowerCase()),
          ),
        }))
        .filter((g) => !query || g.hosts.length),
    [store, query],
  );
  const visibleSidebarHosts = groups.flatMap((group) =>
    expanded.has(group.id) || Boolean(query) ? group.hosts : [],
  );
  const moveSidebarHostSelection = (direction: -1 | 1) => {
    if (!visibleSidebarHosts.length) return;
    const index = visibleSidebarHosts.findIndex(
      (host) => host.id === selectedHostId,
    );
    const next =
      visibleSidebarHosts[
        (index + direction + visibleSidebarHosts.length) %
          visibleSidebarHosts.length
      ];
    setSelectedHostId(next.id);
    setActiveTabId("");
  };
  const focusSelectedSidebarHost = () => {
    if (!selectedHostId) return;
    requestAnimationFrame(() => {
      if (!document.activeElement?.closest(".sidebar nav")) return;
      const element = document.querySelector<HTMLButtonElement>(
        `[data-sidebar-host-id="${CSS.escape(selectedHostId)}"]`,
      );
      element?.focus();
      element?.scrollIntoView({ block: "nearest" });
    });
  };
  useEffect(() => {
    focusSelectedSidebarHost();
  }, [selectedHostId, query, expanded]);
  if (!window.desktop)
    return (
      <div className="fatal">
        {t("desktopOnly")}
        <br />
        <code>npm run desktop</code>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="logo">
          <Command />
        </div>
        <button className="rail-active">
          <TerminalSquare />
        </button>
        <button>
          <LayoutGrid />
        </button>
        <button>
          <Users />
        </button>
        <span />
        <button aria-label={t("settings")} title={`${t("settings")} (⌘,)`} onClick={openSettings}>
          <Settings />
        </button>
        <div className="avatar">SK</div>
      </aside>
      <aside className="sidebar">
        <header>
          <div>
            <p>{t("workspace").toUpperCase()}</p>
            <h1>Orbit SSH</h1>
          </div>
          <button>
            <Ellipsis />
          </button>
        </header>
        <div className="search">
          <Search />
          <input
            aria-label={t("searchServers")}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </div>
        <div className="section-title">
          <span>{t("connections").toUpperCase()}</span>
          <div>
            <button
              className="quick-add"
              data-testid="new-folder"
              title={t("newFolder")}
              aria-label={t("newFolder")}
              onClick={() => setDialog("group")}
            >
              <FolderPlus />
            </button>
            <button
              className="quick-add"
              data-testid="new-connection"
              title={t("newConnection")}
              aria-label={t("newConnection")}
              onClick={() => openHostDialog()}
            >
              <Plus />
            </button>
          </div>
        </div>
        <nav
          tabIndex={0}
          aria-label={t("connections")}
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return;
            if (!selectedHostId && visibleSidebarHosts[0])
              setSelectedHostId(visibleSidebarHosts[0].id);
            else focusSelectedSidebarHost();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Down") {
              event.preventDefault();
              moveSidebarHostSelection(1);
              return;
            }
            if (event.key === "ArrowUp" || event.key === "Up") {
              event.preventDefault();
              moveSidebarHostSelection(-1);
              return;
            }
            if (event.key === "Enter") {
              const host = visibleSidebarHosts.find(
                (item) => item.id === selectedHostId,
              );
              if (!host) return;
              event.preventDefault();
              void connect(host);
              return;
            }
            if (event.key === "Delete" || event.key === "Backspace") {
              event.preventDefault();
              event.stopPropagation();
              removeSelectedSidebarHost();
            }
          }}
        >
          {loaded && groups.length === 0 && (
            <p className="no-connections">{t("noConnections")}</p>
          )}
          {groups.map((g, index) => (
            <div key={g.id} className="tree-group">
              <div className="group-wrap">
                <button
                  className="tree-row folder-row"
                  onClick={() =>
                    setExpanded((x) => {
                      const n = new Set(x);
                      n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                      return n;
                    })
                  }
                >
                  {expanded.has(g.id) || query ? (
                    <ChevronDown />
                  ) : (
                    <ChevronRight />
                  )}
                  <Folder className="folder" />
                  <span>{g.name}</span>
                  <span className="count">{g.hosts.length}</span>
                </button>
                <button
                  className="delete-group"
                  title={t("deleteFolder")}
                  onClick={() => removeGroup(g)}
                >
                  <Trash2 />
                </button>
              </div>
              {(expanded.has(g.id) || Boolean(query)) &&
                g.hosts.map((h) => {
                  const ss = sessions.filter((s) => s.hostId === h.id).at(-1);
                  return (
                    <div className="host-wrap" key={h.id}>
                      <button
                        className={`tree-row host-row ${selectedHostId === h.id ? "selected" : ""}`}
                        data-sidebar-host-id={h.id}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setSelectedHostId(h.id);
                          setActiveTabId("");
                          setSidebarMenu({
                            hostId: h.id,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        onDoubleClick={() => connect(h)}
                        onClick={() => {
                          setSelectedHostId(h.id);
                          setActiveTabId("");
                        }}
                      >
                        <span className={`status ${ss?.state ?? "idle"}`} />
                        <Server />
                        <span className="host-title">
                          <b className="host-name">{h.name}</b>
                          <small>
                            {h.user}@{h.host}:{h.port}
                          </small>
                        </span>
                      </button>
                      <div className="host-actions">
                        <button title={t("edit")} onClick={() => openHostDialog(h)}>
                          <Pencil />
                        </button>
                        <button title={t("delete")} onClick={() => removeHost(h)}>
                          <Trash2 />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          ))}
        </nav>
        <button className="add-connection" onClick={() => openHostDialog()}>
          <Plus /> {t("addConnection")}
        </button>
      </aside>
      {sidebarMenu &&
        (() => {
          const host = store.hosts.find((item) => item.id === sidebarMenu.hostId);
          if (!host) return null;
          return (
            <div
              className="context-menu"
              data-testid="sidebar-context-menu"
              style={{ left: sidebarMenu.x, top: sidebarMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                data-testid="duplicate-session"
                onClick={() => {
                  setSidebarMenu(null);
                  void duplicateHost(host);
                }}
              >
                <Plus /> {t("duplicateSession")}
              </button>
              <button
                type="button"
                className="danger"
                data-testid="delete-session"
                onClick={() => {
                  setSidebarMenu(null);
                  void removeHost(host);
                }}
              >
                <Trash2 /> {t("deleteSession")}
              </button>
            </div>
          );
        })()}
      <main className="workspace">
        <div className="tabs">
          {workspaceTabs.map((s) => {
            const h = getSessionHost(s);
            return (
              h && (
                <button
                  key={s.tabId}
                  onClick={() => {
                    const focusedPane = sessions.find(
                      (session) =>
                        session.workspaceId === s.workspaceId &&
                        session.tabId === activeTabId,
                    );
                    setActiveTabId(focusedPane?.tabId ?? s.tabId);
                    setSelectedHostId(s.kind === "ssh" ? h.id : "");
                  }}
                  className={
                    activeWorkspaceId === s.workspaceId ? "active" : ""
                  }
                >
                  <span className={`status ${s.state}`} />
                  {h.name}
                  <X
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWorkspace(s.workspaceId);
                    }}
                  />
                </button>
              )
            );
          })}
          <button className="tab-plus" onClick={() => openHostDialog()}>
            <Plus />
          </button>
        </div>
        {activeHost ? (
          <>
            <div className="session-bar">
              <div
                className="server-badge"
                style={{
                  background:
                    colors[
                      Math.abs(activeHost.id.charCodeAt(0)) % colors.length
                    ],
                }}
              >
                {activeHost.kind === "local" ? <TerminalSquare /> : <Server />}
              </div>
              <div>
                <h2>{activeHost.name}</h2>
                <p>
                  {activeHost.kind === "local"
                    ? `${activeHost.host} · ${t("systemShell")}`
                    : `${activeHost.user}@${activeHost.host} · port ${activeHost.port}`}
                </p>
              </div>
              {activeSession ? (
                <span className={`connection-state ${activeSession.state}`}>
                  <i /> {stateLabel(activeSession.state)}
                </span>
              ) : activeHost.kind === "ssh" ? (
                <button
                  className="connect-button"
                  onClick={() => selectedHost && connect(selectedHost)}
                >
                  {t("connect")}
                </button>
              ) : null}
              {activeSession &&
                ["closed", "error"].includes(activeSession.state) && (
                  <button
                    className="reconnect"
                    onClick={() => reconnectPane(activeSession.tabId)}
                  >
                    <RotateCw /> {t("reconnect")}
                  </button>
                )}
            </div>
            {sessions.length > 0 && (
              <section
                className={`terminal split-grid panes-${Math.max(visibleSessions.length, 1)} ${activeSession ? "" : "terminal-suspended"}`}
              >
                {sessions.map((session) => {
                  const host = getSessionHost(session);
                  const isVisible = visibleSessions.some(
                    (visible) => visible.tabId === session.tabId,
                  );
                  return (
                    <div
                      key={session.tabId}
                      className={`terminal-pane ${isVisible ? "" : "cached"} ${activeTabId === session.tabId ? "focused" : ""}`}
                      onMouseDown={() => {
                        setActiveTabId(session.tabId);
                        setSelectedHostId(
                          session.kind === "ssh" ? session.hostId : "",
                        );
                      }}
                    >
                      <div className="pane-bar">
                        <span className={`status ${session.state}`} />
                        <b>{host?.name}</b>
                        <small>
                          {host?.kind === "local"
                            ? host.host
                            : `${host?.user}@${host?.host}`}
                        </small>
                        <button
                          title={t("closePane")}
                          onClick={(e) => {
                            e.stopPropagation();
                            closePane(session.tabId);
                          }}
                        >
                          <X />
                        </button>
                      </div>
                      <TerminalPane
                        session={session}
                        settings={settings}
                        language={language}
                        active={activeTabId === session.tabId}
                        onState={(state) =>
                          setSessionState(session.tabId, state)
                        }
                        onReconnect={() => reconnectPane(session.tabId)}
                      />
                    </div>
                  );
                })}
              </section>
            )}
            {!activeSession && activeHost.kind === "ssh" && (
              <div className="ready">
                <TerminalSquare />
                <h2>{t("readyToConnect")}</h2>
                <p>{t("connectDescription")}</p>
                <button onClick={() => selectedHost && connect(selectedHost)}>
                  {t("connectTo", { name: activeHost.name })}
                </button>
              </div>
            )}
            <footer>
              <span>
                <i /> {activeSession?.kind === "local" ? t("systemShell") : t("systemOpenSsh")}
              </span>
              <span>UTF-8</span>
              <span>PTY · xterm-256color</span>
              <span>v{appVersion}</span>
            </footer>
          </>
        ) : (
          <div className="empty">
            <TerminalSquare />
            <h2>{loaded ? t("noActiveSessions") : t("loading")}</h2>
            <p>{t("selectOrAddServer")}</p>
          </div>
        )}
      </main>
      {updateInfo?.updateAvailable && !updateDismissed && (
        <aside className="update-toast" role="status" aria-label={t("updateNotice")}>
          <div className="update-toast-icon"><Download /></div>
          <div>
            <b>Orbit SSH v{updateInfo.latestVersion}</b>
            <span>{t("newVersionAvailable")}</span>
          </div>
          <button
            type="button"
            className="update-toast-download"
            onClick={downloadUpdate}
            disabled={!updateInfo.assetName || updateStatus.phase === "downloading"}
          >
            {updateStatus.phase === "downloading" ? `${updateStatus.percent ?? 0}%` : t("downloadDmg")}
          </button>
          <button type="button" className="update-toast-close" aria-label={t("dismissUpdate")} onClick={() => setUpdateDismissed(true)}>
            <X />
          </button>
        </aside>
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <div className={`modal ${dialog === "settings" ? "settings-modal" : ""}`}>
            <button
              className="modal-close"
              aria-label={t("close")}
              onClick={() => setDialog(null)}
            >
              <X />
            </button>
            {dialog === "settings" ? (
              <SettingsForm
                value={settingsDraft}
                appVersion={appVersion}
                architecture={window.desktop.architecture}
                updateInfo={updateInfo}
                updateStatus={updateStatus}
                updateError={updateError}
                onChange={setSettingsDraft}
                onSubmit={submitSettings}
                onCancel={() => setDialog(null)}
                onCheckUpdates={() => void checkUpdates()}
                onDownloadUpdate={() => void downloadUpdate()}
                onOpenRelease={() => void window.desktop?.updates.openRelease()}
              />
            ) : dialog === "session" ? (
              <div className="session-picker">
                <h2>{t("newSession")}</h2>
                <p>{t("newSessionDescription")}</p>
                {sessionPickerItems.length > 0 ? (
                  <div
                    className="session-picker-list"
                    role="listbox"
                    aria-label={t("newSession")}
                  >
                    <section>
                      <h3>{t("localMachine")}</h3>
                      <button
                        type="button"
                        role="option"
                        aria-selected={sessionPickerHostId === LOCAL_HOST_ID}
                        className={
                          sessionPickerHostId === LOCAL_HOST_ID
                            ? "selected"
                            : ""
                        }
                        data-testid="session-picker-host"
                        data-session-host-id={LOCAL_HOST_ID}
                        autoFocus={sessionPickerHostId === LOCAL_HOST_ID}
                        ref={(element) => {
                          if (
                            element &&
                            sessionPickerHostId === LOCAL_HOST_ID &&
                            document.activeElement?.closest(".session-picker")
                          )
                            element.scrollIntoView({ block: "nearest" });
                        }}
                        onClick={() => setSessionPickerHostId(LOCAL_HOST_ID)}
                        onDoubleClick={() =>
                          openPickedSession({
                            id: LOCAL_HOST_ID,
                            kind: "local",
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            openPickedSession({
                              id: LOCAL_HOST_ID,
                              kind: "local",
                            });
                            return;
                          }
                          if (
                            event.key === "ArrowDown" ||
                            event.key === "Down"
                          ) {
                            event.preventDefault();
                            moveSessionPickerSelection(1);
                            return;
                          }
                          if (
                            event.key === "ArrowUp" ||
                            event.key === "Up"
                          ) {
                            event.preventDefault();
                            moveSessionPickerSelection(-1);
                          }
                        }}
                      >
                        <span className="status connected" />
                        <TerminalSquare />
                        <span className="session-picker-name">
                          <b>{t("localTerminal")}</b>
                        </span>
                        <small>{t("systemShell")}</small>
                      </button>
                    </section>
                    {store.groups.map((group) => {
                      const hosts = sessionPickerHosts.filter(
                        (item) => item.group.id === group.id,
                      );
                      if (!hosts.length) return null;
                      return (
                        <section key={group.id}>
                          <h3>{group.name}</h3>
                          {hosts.map(({ host }) => (
                            <button
                              key={host.id}
                              type="button"
                              role="option"
                              aria-selected={sessionPickerHostId === host.id}
                              className={
                                sessionPickerHostId === host.id
                                  ? "selected"
                                  : ""
                              }
                              data-testid="session-picker-host"
                              data-session-host-id={host.id}
                              autoFocus={sessionPickerHostId === host.id}
                              ref={(element) => {
                                if (
                                  element &&
                                  sessionPickerHostId === host.id &&
                                  document.activeElement?.closest(
                                    ".session-picker",
                                  )
                                )
                                  element.scrollIntoView({
                                    block: "nearest",
                                  });
                              }}
                              onClick={() => setSessionPickerHostId(host.id)}
                              onDoubleClick={() =>
                                openPickedSession({
                                  id: host.id,
                                  kind: "ssh",
                                  host,
                                  group,
                                })
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  openPickedSession({
                                    id: host.id,
                                    kind: "ssh",
                                    host,
                                    group,
                                  });
                                  return;
                                }
                                if (
                                  event.key === "ArrowDown" ||
                                  event.key === "Down"
                                ) {
                                  event.preventDefault();
                                  moveSessionPickerSelection(1);
                                  return;
                                }
                                if (
                                  event.key === "ArrowUp" ||
                                  event.key === "Up"
                                ) {
                                  event.preventDefault();
                                  moveSessionPickerSelection(-1);
                                }
                              }}
                            >
                              <span className="status idle" />
                              <Server />
                              <span className="session-picker-name">
                                <b>{host.name}</b>
                              </span>
                              <small>
                                {host.user}@{host.host}:{host.port}
                              </small>
                            </button>
                          ))}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <p className="session-picker-empty">{t("noServersToOpen")}</p>
                )}
                <div className="modal-actions">
                  <button type="button" onClick={() => setDialog(null)}>
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    data-testid="session-picker-open"
                    disabled={!sessionPickerHostId}
                    onClick={() =>
                      openPickedSession(
                        sessionPickerItems.find(
                          (item) => item.id === sessionPickerHostId,
                        ),
                      )
                    }
                  >
                    {t("openSession")}
                  </button>
                </div>
              </div>
            ) : dialog === "group" ? (
              <form onSubmit={submitGroup}>
                <h2>{t("newFolder")}</h2>
                <p>{t("newFolderDescription")}</p>
                <label>
                  {t("folderName")}
                  <input
                    name="name"
                    autoFocus
                    placeholder="Production"
                    required
                  />
                </label>
                <div className="modal-actions">
                  <button type="button" onClick={() => setDialog(null)}>
                    {t("cancel")}
                  </button>
                  <button className="primary">{t("create")}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitHost}>
                <h2>{editing ? t("editConnection") : t("newSshConnection")}</h2>
                <p>{t("connectionDescription")}</p>
                <label>
                  {t("deviceName")}
                  <input
                    autoFocus
                    data-testid="device-name"
                    aria-label={t("deviceName")}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Production API"
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    {t("host")}
                    <input
                      data-testid="connection-host"
                      aria-label={t("host")}
                      value={form.host}
                      onChange={(e) =>
                        setForm({ ...form, host: e.target.value })
                      }
                      placeholder="192.168.0.10"
                      required
                    />
                  </label>
                  <label className="port">
                    {t("port")}
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={form.port}
                      onChange={(e) =>
                        setForm({ ...form, port: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  {t("user")}
                  <input
                    data-testid="connection-user"
                    aria-label={t("user")}
                    value={form.user}
                    onChange={(e) => setForm({ ...form, user: e.target.value })}
                    placeholder="ubuntu"
                    required
                  />
                </label>
                <label>
                  {t("folder")}
                  <select
                    value={form.groupId}
                    onChange={(e) =>
                      setForm({ ...form, groupId: e.target.value })
                    }
                    required
                  >
                    <option value="" disabled>
                      {t("selectFolder")}
                    </option>
                    {store.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="auth-options">
                  <legend>{t("authMethod")}</legend>
                  <label
                    className={form.authType === "password" ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="authType"
                      value="password"
                      checked={form.authType === "password"}
                      onChange={() =>
                        setForm({ ...form, authType: "password" })
                      }
                    />
                    <LockKeyhole />
                    <span>
                      <b>{t("password")}</b>
                      <small>{t("passwordKeychain")}</small>
                    </span>
                  </label>
                  <label className={form.authType === "key" ? "selected" : ""}>
                    <input
                      type="radio"
                      name="authType"
                      value="key"
                      checked={form.authType === "key"}
                      onChange={() => setForm({ ...form, authType: "key" })}
                    />
                    <KeyRound />
                    <span>
                      <b>{t("sshKey")}</b>
                      <small>{t("keyOrAgent")}</small>
                    </span>
                  </label>
                </fieldset>
                {form.authType === "password" ? (
                  <label>
                    {t("password")} {editing && <span>{t("onlyWhenChanging")}</span>}
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      placeholder={
                        editing ? t("keepExistingPassword") : t("sshPassword")
                      }
                      required={!editing}
                      autoComplete="new-password"
                    />
                  </label>
                ) : (
                  <label>
                    {t("privateKeyPath")}{" "}
                    <span>{t("emptyUsesAgent")}</span>
                    <input
                      value={form.identityFile}
                      onChange={(e) =>
                        setForm({ ...form, identityFile: e.target.value })
                      }
                      placeholder="~/.ssh/id_ed25519"
                    />
                  </label>
                )}
                <div className="modal-actions">
                  <button type="button" onClick={() => setDialog(null)}>
                    {t("cancel")}
                  </button>
                  <button className="primary">
                    {editing ? t("save") : t("add")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
