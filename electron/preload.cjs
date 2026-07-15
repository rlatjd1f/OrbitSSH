const { clipboard, contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  isDesktop: true,
  store: {
    load: () => ipcRenderer.invoke("store:load"),
    save: (data) => ipcRenderer.invoke("store:save", data),
  },
  settings: {
    load: () => ipcRenderer.invoke("settings:load"),
    save: (value) => ipcRenderer.invoke("settings:save", value),
  },
  terminal: {
    start: (host) => ipcRenderer.invoke("terminal:start", host),
    write: (sessionId, data) =>
      ipcRenderer.send("terminal:write", { sessionId, data }),
    setActive: (sessionId) =>
      ipcRenderer.send("terminal:set-active", sessionId),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.send("terminal:resize", { sessionId, cols, rows }),
    close: (sessionId) => ipcRenderer.invoke("terminal:close", sessionId),
    onData: (callback) => {
      const fn = (_e, value) => callback(value);
      ipcRenderer.on("terminal:data", fn);
      return () => ipcRenderer.removeListener("terminal:data", fn);
    },
    onExit: (callback) => {
      const fn = (_e, value) => callback(value);
      ipcRenderer.on("terminal:exit", fn);
      return () => ipcRenderer.removeListener("terminal:exit", fn);
    },
  },
  clipboard: {
    writeText: (value) => clipboard.writeText(value),
  },
  onShortcut: (callback) => {
    const fn = (_e, action) => callback(action);
    ipcRenderer.on("shortcut:action", fn);
    return () => ipcRenderer.removeListener("shortcut:action", fn);
  },
});
