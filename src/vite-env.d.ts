/// <reference types="vite/client" />

type ConnectionGroup = { id: string; name: string; parentId: string | null };
type ConnectionHost = {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  groupId: string;
  authType: "password" | "key";
  identityFile: string;
  password?: string;
};
type ConnectionStore = { groups: ConnectionGroup[]; hosts: ConnectionHost[] };
type AppSettings = {
  language: "ko" | "en";
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalLineHeight: number;
  cursorBlink: boolean;
  scrollback: number;
  defaultUser: string;
  defaultPort: number;
  defaultAuthType: "password" | "key";
  keepAliveInterval: number;
};
type UpdateInfo = {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string;
  tagName: string;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  assetName: string | null;
  architecture: string;
};
type UpdateStatus = {
  phase: "idle" | "checking" | "downloading" | "completed" | "error";
  percent?: number;
  received?: number;
  total?: number;
  fileName?: string;
  path?: string;
  opened?: boolean;
  message?: string;
};

interface Window {
  desktop?: {
    platform: string;
    architecture: string;
    isDesktop: boolean;
    app: { getVersion(): Promise<string> };
    updates: {
      check(force?: boolean): Promise<UpdateInfo>;
      download(): Promise<{ path: string; opened: boolean; openError: string }>;
      openRelease(): Promise<void>;
      onStatus(callback: (value: UpdateStatus) => void): () => void;
    };
    store: {
      load(): Promise<ConnectionStore>;
      save(data: ConnectionStore): Promise<ConnectionStore>;
    };
    settings: {
      load(): Promise<AppSettings>;
      save(value: AppSettings): Promise<AppSettings>;
    };
    terminal: {
      start(host: ConnectionHost): Promise<string>;
      write(sessionId: string, data: string): void;
      setActive(sessionId: string | null): void;
      resize(sessionId: string, cols: number, rows: number): void;
      close(sessionId: string): Promise<void>;
      onData(
        callback: (value: { sessionId: string; data: string }) => void,
      ): () => void;
      onExit(
        callback: (value: {
          sessionId: string;
          exitCode: number;
          signal: number;
        }) => void,
      ): () => void;
    };
    clipboard: { writeText(value: string): void };
    debug?: {
      logShortcut(event: string, details?: Record<string, unknown>): void;
    };
    onShortcut(
      callback: (
        action:
          | "close-tab"
          | "next-tab"
          | "previous-pane"
          | "next-pane"
          | "duplicate-tab"
          | "open-session"
          | "split-tab"
          | "open-settings"
          | "copy-selection",
      ) => void,
    ): () => void;
  };
}
