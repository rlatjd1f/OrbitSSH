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

interface Window {
  desktop?: {
    platform: string;
    isDesktop: boolean;
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
    onShortcut(
      callback: (
        action:
          | "close-tab"
          | "next-tab"
          | "split-tab"
          | "open-settings"
          | "copy-selection",
      ) => void,
    ): () => void;
  };
}
