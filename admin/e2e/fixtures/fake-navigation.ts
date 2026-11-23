declare global {
  interface Window {
    __refreshed?: number;
    __path?: string;
  }
}

// Stands in for next/navigation in the offline upload-panel test: refresh() only counts how often it was called.
export function useRouter() {
  return {
    refresh() {
      window.__refreshed = (window.__refreshed ?? 0) + 1;
    },
  };
}
export function notFound(): never {
  throw new Error("notFound");
}
export function redirect(path: string): never {
  window.__path = path;
  throw new Error(`redirect:${path}`);
}
export function usePathname() {
  return window.__path ?? "/admin";
}
