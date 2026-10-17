export {};

declare global {
  interface Window {
    rocoDesktop?: {
      copyText(text: string): Promise<boolean>;
      showOpenDialog(): Promise<string | null>;
      showSaveDialog(): Promise<string | null>;
      readTextFile(filePath: string): Promise<string>;
      writeTextFile(filePath: string, text: string): Promise<boolean>;
      statFile(filePath: string): Promise<{ mtimeMs: number; size: number }>;
      /** Electron 32+ 用 webUtils.getPathForFile 取代已移除的 File.path */
      getPathForFile(file: File): string;
      openExternal(target: string): Promise<boolean>;
    };
    rocoFloat?: {
      toggle(): void;
      close(): void;
      reportShape(rect: { x: number; y: number; width: number; height: number }): void;
      openMenu(payload: { side: string; slot: number; rect?: { x: number; y: number; width: number; height: number } }): void;
      closeMenu(): void;
    };
  }
}
