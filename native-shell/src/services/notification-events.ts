export type AppNotice = { id?: string; title: string; body: string; path?: string; userId?: string };
type Listener = (notice: AppNotice) => void;
const listeners = new Set<Listener>();
export function announce(notice: AppNotice) { listeners.forEach((listener) => listener(notice)); }
export function listenForNotices(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
