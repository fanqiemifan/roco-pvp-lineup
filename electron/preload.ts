import { contextBridge, ipcRenderer } from 'electron';

const rocoDesktop = {
  copyText(text: string) {
    return ipcRenderer.invoke('roco:copy-text', text);
  },
  showOpenDialog() {
    return ipcRenderer.invoke('roco:show-open-dialog');
  },
  showSaveDialog() {
    return ipcRenderer.invoke('roco:show-save-dialog');
  },
  readTextFile(filePath: string) {
    return ipcRenderer.invoke('roco:read-text-file', filePath);
  },
  writeTextFile(filePath: string, text: string) {
    return ipcRenderer.invoke('roco:write-text-file', filePath, text);
  },
  statFile(filePath: string) {
    return ipcRenderer.invoke('roco:stat-file', filePath);
  },
  openExternal(target: string) {
    return ipcRenderer.invoke('roco:open-external', target);
  },
};

const rocoFloat = {
  toggle() {
    ipcRenderer.send('float:toggle');
  },
  close() {
    ipcRenderer.send('float:close');
  },
  reportShape(rect: { x: number; y: number; width: number; height: number }) {
    ipcRenderer.send('float:shape', rect);
  },
  openMenu(payload: { side: string; slot: number; viewSide?: string; rect?: { x: number; y: number; width: number; height: number } }) {
    ipcRenderer.send('float:menu', payload);
  },
  closeMenu() {
    ipcRenderer.send('float:menu-close');
  },
};

contextBridge.exposeInMainWorld('rocoDesktop', rocoDesktop);
contextBridge.exposeInMainWorld('rocoFloat', rocoFloat);
