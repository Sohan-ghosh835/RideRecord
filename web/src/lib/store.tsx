import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadBundle, listVehicles, listOverlay, type VehicleBundle } from '../db/repo';
import { mergeCatalog } from '../domain/catalog';
import type { CatalogEntry, Vehicle } from '../domain/types';

interface Ctx { version: number; bump: () => void; toast: (msg: string) => void; online: boolean }
const C = createContext<Ctx>({ version: 0, bump: () => {}, toast: () => {}, online: true });
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const timer = useRef<number | undefined>(undefined);
  const bump = useCallback(() => setVersion(v => v + 1), []);
  const toast = useCallback((m: string) => { setMsg(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(null), 3500); }, []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const value = useMemo(() => ({ version, bump, toast, online }), [version, bump, toast, online]);
  return <C.Provider value={value}>{children}{msg && <div className="toast" role="status" aria-live="polite">{msg}</div>}</C.Provider>;
}

export interface Async<T> { data?: T; error?: string; loading: boolean }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const { version } = useApp();
  const [state, setState] = useState<Async<T>>({ loading: true });
  useEffect(() => {
    let live = true;
    fn().then(data => live && setState({ data, loading: false }), e => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}

export const useVehicles = (): Async<Vehicle[]> => useAsync(() => listVehicles(), []);
export const useBundle = (id: string | undefined): Async<VehicleBundle | undefined> => useAsync(() => (id ? loadBundle(id) : Promise.resolve(undefined)), [id]);
export const useCatalog = (): Async<CatalogEntry[]> => useAsync(async () => mergeCatalog(await listOverlay()), []);
