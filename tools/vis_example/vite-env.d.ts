/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    platform: string;
    versions: Record<string, string>;
  };
}
