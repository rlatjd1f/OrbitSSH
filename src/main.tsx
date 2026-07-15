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

type SessionState = "connecting" | "connected" | "closed" | "error";
type Session = {
  tabId: string;
  workspaceId: string;
  hostId: string;
  sessionId?: string;
  state: SessionState;
};
const emptyStore: ConnectionStore = { groups: [], hosts: [] };
const defaultSettings: AppSettings = {
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
  ["시스템 고정폭", "ui-monospace, SFMono-Regular, monospace"],
] as const;

function TerminalPane({
  session,
  settings,
  active,
  onState,
  onReconnect,
}: {
  session: Session;
  settings: AppSettings;
  active: boolean;
  onState: (state: SessionState) => void;
  onReconnect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionRef = useRef(session);
  const onStateRef = useRef(onState);
  const onReconnectRef = useRef(onReconnect);
  sessionRef.current = session;
  onStateRef.current = onState;
  onReconnectRef.current = onReconnect;
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
    const activate = () =>
      window.desktop?.terminal.setActive(
        sessionRef.current.sessionId ?? null,
      );
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
        term.writeln("\r\n\x1b[90m[재접속 중...]\x1b[0m");
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
          `\r\n\x1b[90m[연결 종료 · exit ${v.exitCode}]\r\n[Enter를 누르면 다시 연결합니다]\x1b[0m`,
        );
        onStateRef.current(v.exitCode === 0 ? "closed" : "error");
      }
    });
    if (!sessionRef.current.sessionId)
      term.writeln("\x1b[90m연결을 시작하는 중...\x1b[0m");
    else {
      onResize();
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
  const update = <K extends keyof AppSettings>(key: K, next: AppSettings[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <form onSubmit={onSubmit}>
      <h2>설정</h2>
      <p>Orbit SSH 전체에 적용되는 기본 동작을 관리합니다.</p>
      <section className="settings-section">
        <h3>터미널</h3>
        <div className="settings-grid">
          <label className="settings-wide">
            터미널 폰트
            <select
              aria-label="터미널 폰트"
              value={value.terminalFontFamily}
              onChange={(event) =>
                update("terminalFontFamily", event.target.value)
              }
              style={{ fontFamily: value.terminalFontFamily }}
            >
              {!terminalFonts.some(([, font]) => font === value.terminalFontFamily) && (
                <option value={value.terminalFontFamily}>현재 설정</option>
              )}
              {terminalFonts.map(([label, font]) => (
                <option key={label} value={font}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            글꼴 크기
            <input aria-label="터미널 글꼴 크기" type="number" min="9" max="24" value={value.terminalFontSize} onChange={(e) => update("terminalFontSize", Number(e.target.value))} />
          </label>
          <label>
            줄 간격
            <select aria-label="터미널 줄 간격" value={value.terminalLineHeight} onChange={(e) => update("terminalLineHeight", Number(e.target.value))}>
              <option value="1.2">좁게</option><option value="1.45">기본</option><option value="1.7">넓게</option>
            </select>
          </label>
          <label>
            탭당 스크롤 버퍼 (줄)
            <input aria-label="터미널 스크롤 버퍼" type="number" min="1000" max="50000" step="1000" value={value.scrollback} onChange={(e) => update("scrollback", Number(e.target.value))} />
          </label>
          <label className="setting-toggle">
            <span><b>커서 깜빡임</b><small>활성 터미널 커서를 깜빡입니다.</small></span>
            <input aria-label="커서 깜빡임" type="checkbox" checked={value.cursorBlink} onChange={(e) => update("cursorBlink", e.target.checked)} />
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h3>새 연결 기본값</h3>
        <div className="settings-grid">
          <label>기본 사용자<input aria-label="기본 사용자" value={value.defaultUser} onChange={(e) => update("defaultUser", e.target.value)} placeholder="ubuntu" /></label>
          <label>기본 포트<input aria-label="기본 포트" type="number" min="1" max="65535" value={value.defaultPort} onChange={(e) => update("defaultPort", Number(e.target.value))} /></label>
          <label>기본 인증방식<select aria-label="기본 인증방식" value={value.defaultAuthType} onChange={(e) => update("defaultAuthType", e.target.value as "password" | "key")}><option value="key">SSH 개인 키</option><option value="password">비밀번호</option></select></label>
        </div>
      </section>
      <section className="settings-section">
        <h3>SSH 연결</h3>
        <div className="settings-grid">
          <label>KeepAlive 간격 (초, 0은 끔)<input aria-label="KeepAlive 간격" type="number" min="0" max="600" value={value.keepAliveInterval} onChange={(e) => update("keepAliveInterval", Number(e.target.value))} /></label>
        </div>
      </section>
      <section className="settings-section update-section">
        <h3>앱 업데이트</h3>
        <div className="update-card">
          <div>
            <b data-testid="app-version">Orbit SSH v{appVersion || "-"}</b>
            <small>
              현재 설치 버전 · {architecture === "arm64" ? "Apple Silicon" : architecture === "x64" ? "Intel Mac" : architecture}
            </small>
          </div>
          <button
            type="button"
            aria-label="업데이트 확인"
            onClick={onCheckUpdates}
            disabled={updateStatus.phase === "checking" || updateStatus.phase === "downloading"}
          >
            <RotateCw className={updateStatus.phase === "checking" ? "spinning" : ""} />
            {updateStatus.phase === "checking" ? "확인 중" : "업데이트 확인"}
          </button>
        </div>
        {updateInfo?.updateAvailable ? (
          <div className="update-result available">
            <div>
              <b>v{updateInfo.latestVersion} 업데이트 사용 가능</b>
              <small>
                {updateInfo.assetName
                  ? `${architecture === "arm64" ? "Apple Silicon" : "Intel Mac"}용 DMG를 받을 수 있습니다.`
                  : "현재 Mac과 호환되는 DMG가 릴리즈에 없습니다."}
              </small>
            </div>
            <div className="update-actions">
              <button type="button" onClick={onOpenRelease}>
                <ExternalLink /> 릴리즈 노트
              </button>
              <button
                type="button"
                className="primary"
                onClick={onDownloadUpdate}
                disabled={!updateInfo.assetName || updateStatus.phase === "downloading"}
              >
                <Download /> {updateStatus.phase === "downloading" ? `${updateStatus.percent ?? 0}%` : "DMG 받기"}
              </button>
            </div>
          </div>
        ) : updateInfo ? (
          <p className="update-message">최신 버전을 사용하고 있습니다.</p>
        ) : null}
        {updateStatus.phase === "downloading" && (
          <div className="update-progress" aria-label="업데이트 다운로드 진행률">
            <span style={{ width: `${updateStatus.percent ?? 0}%` }} />
          </div>
        )}
        {updateStatus.phase === "completed" && (
          <p className="update-message success">DMG를 열었습니다. Orbit SSH를 Applications 폴더로 옮겨 설치해 주세요.</p>
        )}
        {updateError && <p className="update-message error">{updateError}</p>}
      </section>
      <div className="modal-actions"><button type="button" onClick={onCancel}>취소</button><button className="primary">설정 저장</button></div>
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
  const [dialog, setDialog] = useState<"host" | "group" | "settings" | null>(
    null,
  );
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
  const activeSession = sessions.find((s) => s.tabId === activeTabId);
  const activeWorkspaceId = activeSession?.workspaceId;
  const activeHost = store.hosts.find(
    (h) => h.id === (activeSession?.hostId ?? selectedHostId),
  );
  const visibleSessions = activeWorkspaceId
    ? sessions.filter((session) => session.workspaceId === activeWorkspaceId)
    : [];
  const workspaceTabs = sessions.filter(
    (session, index, all) =>
      all.findIndex((item) => item.workspaceId === session.workspaceId) ===
      index,
  );

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
        setUpdateError(status.message ?? "업데이트 다운로드에 실패했습니다.");
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
  }, [loaded]);
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
        error instanceof Error ? error.message : "업데이트 확인에 실패했습니다.",
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
        error instanceof Error ? error.message : "업데이트 다운로드에 실패했습니다.",
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
  const persist = async (next: ConnectionStore) => {
    const saved = await window.desktop!.store.save(next);
    setStore(saved);
    return saved;
  };
  const openSettings = () => {
    setSettingsDraft(settings);
    setDialog("settings");
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
    if (!confirm(`“${host.name}” 서버를 삭제할까요?`)) return;
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
  const removeGroup = async (group: ConnectionGroup) => {
    if (store.hosts.some((h) => h.groupId === group.id)) {
      alert("폴더 안의 서버를 먼저 삭제하거나 이동해 주세요.");
      return;
    }
    if (confirm(`“${group.name}” 폴더를 삭제할까요?`))
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
      { tabId, workspaceId, hostId: host.id, state: "connecting" },
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
  const reconnectPane = async (tabId: string) => {
    const pane = sessions.find((session) => session.tabId === tabId);
    if (!pane || !["closed", "error"].includes(pane.state)) return;
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
      if (next) setSelectedHostId(next.hostId);
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
      if (next) setSelectedHostId(next.hostId);
    }
  };
  const setSessionState = (tabId: string, state: SessionState) =>
    setSessions((x) => x.map((s) => (s.tabId === tabId ? { ...s, state } : s)));
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
            const host = store.hosts.find((h) => h.id === activeSession.hostId);
            if (host) void connect(host, true);
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
          setSelectedHostId(next.hostId);
        }
      }),
    [sessions, activeTabId, store, settings],
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
  if (!window.desktop)
    return (
      <div className="fatal">
        이 화면은 데스크톱 앱에서 실행해야 합니다.
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
        <button aria-label="설정" title="설정 (⌘,)" onClick={openSettings}>
          <Settings />
        </button>
        <div className="avatar">SK</div>
      </aside>
      <aside className="sidebar">
        <header>
          <div>
            <p>WORKSPACE</p>
            <h1>Orbit SSH</h1>
          </div>
          <button>
            <Ellipsis />
          </button>
        </header>
        <div className="search">
          <Search />
          <input
            aria-label="서버 검색"
            placeholder="Search servers..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </div>
        <div className="section-title">
          <span>CONNECTIONS</span>
          <div>
            <button
              className="quick-add"
              title="새 폴더"
              aria-label="새 폴더"
              onClick={() => setDialog("group")}
            >
              <FolderPlus />
            </button>
            <button
              className="quick-add"
              title="새 커넥션"
              aria-label="새 커넥션"
              onClick={() => openHostDialog()}
            >
              <Plus />
            </button>
          </div>
        </div>
        <nav>
          {loaded && groups.length === 0 && (
            <p className="no-connections">등록된 서버가 없습니다.</p>
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
                  title="폴더 삭제"
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
                        onDoubleClick={() => connect(h)}
                        onClick={() => {
                          setSelectedHostId(h.id);
                          setActiveTabId("");
                        }}
                      >
                        <span className={`status ${ss?.state ?? "idle"}`} />
                        <Server />
                        <span className="host-title">
                          <b>{h.name}</b>
                          <small>
                            {h.user}@{h.host}:{h.port}
                          </small>
                        </span>
                      </button>
                      <div className="host-actions">
                        <button title="수정" onClick={() => openHostDialog(h)}>
                          <Pencil />
                        </button>
                        <button title="삭제" onClick={() => removeHost(h)}>
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
          <Plus /> New connection
        </button>
      </aside>
      <main className="workspace">
        <div className="tabs">
          {workspaceTabs.map((s) => {
            const h = store.hosts.find((v) => v.id === s.hostId);
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
                    setSelectedHostId(h.id);
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
                <Server />
              </div>
              <div>
                <h2>{activeHost.name}</h2>
                <p>
                  {activeHost.user}@{activeHost.host} · port {activeHost.port}
                </p>
              </div>
              {activeSession ? (
                <span className={`connection-state ${activeSession.state}`}>
                  <i /> {activeSession.state.toUpperCase()}
                </span>
              ) : (
                <button
                  className="connect-button"
                  onClick={() => connect(activeHost)}
                >
                  Connect
                </button>
              )}
              {activeSession &&
                ["closed", "error"].includes(activeSession.state) && (
                  <button
                    className="reconnect"
                    onClick={() => reconnectPane(activeSession.tabId)}
                  >
                    <RotateCw /> Reconnect
                  </button>
                )}
            </div>
            {sessions.length > 0 && (
              <section
                className={`terminal split-grid panes-${Math.max(visibleSessions.length, 1)} ${activeSession ? "" : "terminal-suspended"}`}
              >
                {sessions.map((session) => {
                  const host = store.hosts.find((h) => h.id === session.hostId);
                  const isVisible = visibleSessions.some(
                    (visible) => visible.tabId === session.tabId,
                  );
                  return (
                    <div
                      key={session.tabId}
                      className={`terminal-pane ${isVisible ? "" : "cached"} ${activeTabId === session.tabId ? "focused" : ""}`}
                      onMouseDown={() => {
                        setActiveTabId(session.tabId);
                        setSelectedHostId(session.hostId);
                      }}
                    >
                      <div className="pane-bar">
                        <span className={`status ${session.state}`} />
                        <b>{host?.name}</b>
                        <small>
                          {host?.user}@{host?.host}
                        </small>
                        <button
                          title="패널 닫기"
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
            {!activeSession && (
              <div className="ready">
                <TerminalSquare />
                <h2>Ready to connect</h2>
                <p>Connect를 누르면 시스템 SSH로 접속합니다.</p>
                <button onClick={() => connect(activeHost)}>
                  Connect to {activeHost.name}
                </button>
              </div>
            )}
            <footer>
              <span>
                <i /> SYSTEM OPENSSH
              </span>
              <span>UTF-8</span>
              <span>PTY · xterm-256color</span>
              <span>v{appVersion}</span>
            </footer>
          </>
        ) : (
          <div className="empty">
            <TerminalSquare />
            <h2>{loaded ? "No active sessions" : "Loading..."}</h2>
            <p>왼쪽에서 서버를 선택하거나 새 연결을 추가하세요.</p>
          </div>
        )}
      </main>
      {updateInfo?.updateAvailable && !updateDismissed && (
        <aside className="update-toast" role="status" aria-label="새 업데이트 알림">
          <div className="update-toast-icon"><Download /></div>
          <div>
            <b>Orbit SSH v{updateInfo.latestVersion}</b>
            <span>새 버전을 사용할 수 있습니다.</span>
          </div>
          <button
            type="button"
            className="update-toast-download"
            onClick={downloadUpdate}
            disabled={!updateInfo.assetName || updateStatus.phase === "downloading"}
          >
            {updateStatus.phase === "downloading" ? `${updateStatus.percent ?? 0}%` : "DMG 받기"}
          </button>
          <button type="button" className="update-toast-close" aria-label="업데이트 알림 닫기" onClick={() => setUpdateDismissed(true)}>
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
              aria-label="닫기"
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
            ) : dialog === "group" ? (
              <form onSubmit={submitGroup}>
                <h2>새 폴더</h2>
                <p>
                  서버를 분류할 폴더를 만듭니다. ESC를 눌러 닫을 수 있습니다.
                </p>
                <label>
                  폴더 이름
                  <input
                    name="name"
                    autoFocus
                    placeholder="Production"
                    required
                  />
                </label>
                <div className="modal-actions">
                  <button type="button" onClick={() => setDialog(null)}>
                    취소
                  </button>
                  <button className="primary">만들기</button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitHost}>
                <h2>{editing ? "연결 수정" : "새 SSH 연결"}</h2>
                <p>실제 SSH 접속에 사용할 정보와 인증 방식을 입력하세요.</p>
                <label>
                  장비 이름
                  <input
                    autoFocus
                    aria-label="장비 이름"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Production API"
                    required
                  />
                </label>
                <div className="form-row">
                  <label>
                    호스트
                    <input
                      aria-label="호스트"
                      value={form.host}
                      onChange={(e) =>
                        setForm({ ...form, host: e.target.value })
                      }
                      placeholder="192.168.0.10"
                      required
                    />
                  </label>
                  <label className="port">
                    포트
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
                  사용자
                  <input
                    aria-label="사용자"
                    value={form.user}
                    onChange={(e) => setForm({ ...form, user: e.target.value })}
                    placeholder="ubuntu"
                    required
                  />
                </label>
                <label>
                  폴더
                  <select
                    value={form.groupId}
                    onChange={(e) =>
                      setForm({ ...form, groupId: e.target.value })
                    }
                    required
                  >
                    <option value="" disabled>
                      폴더 선택
                    </option>
                    {store.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="auth-options">
                  <legend>접속 방식</legend>
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
                      <b>비밀번호</b>
                      <small>macOS Keychain에 안전하게 저장</small>
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
                      <b>SSH 개인 키</b>
                      <small>키 파일 또는 SSH Agent 사용</small>
                    </span>
                  </label>
                </fieldset>
                {form.authType === "password" ? (
                  <label>
                    비밀번호 {editing && <span>(변경할 때만 입력)</span>}
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                      placeholder={
                        editing ? "기존 비밀번호 유지" : "SSH 비밀번호"
                      }
                      required={!editing}
                      autoComplete="new-password"
                    />
                  </label>
                ) : (
                  <label>
                    SSH 개인 키 경로{" "}
                    <span>(비우면 SSH Agent/기본 키 사용)</span>
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
                    취소
                  </button>
                  <button className="primary">
                    {editing ? "저장" : "추가"}
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
