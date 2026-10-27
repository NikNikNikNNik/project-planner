import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Factory, LockKeyhole } from 'lucide-react';
import { getAppSession, loginApp, logoutApp } from '@workspace/api-client-react';

const authRequiredEvent = 'planner-auth-required';
const AuthContext = createContext<{ logout: () => Promise<void>; busy: boolean } | null>(null);

export function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401;
}

export function notifyAuthRequired(error: unknown) {
  if (isUnauthorized(error)) window.dispatchEvent(new Event(authRequiredEvent));
}

export function useAppAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('Authentication context is missing');
  return auth;
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data;
    if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') return data.error;
  }
  return fallback;
}

export function AuthGate({ children, onLogout, onResume }: {
  children: ReactNode;
  onLogout: () => void;
  onResume: () => void;
}) {
  const [authenticated, setAuthenticated] = useState(false);
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const checkingRef = useRef(false);
  const authVersion = useRef(0);
  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    const version = authVersion.current;
    try {
      const result = await getAppSession({ credentials: 'same-origin', cache: 'no-store' });
      if (version !== authVersion.current) return;
      setConfigured(result.configured);
      setAuthenticated(result.authenticated);
      if (result.authenticated) setOpened(true);
      if (!result.configured) setError('Вход не настроен. Проверьте защищённые настройки сервера.');
    } catch {
      if (version !== authVersion.current) return;
      setError('Не удалось связаться с сервером. Проверьте соединение и повторите попытку.');
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const expired = () => {
      authVersion.current++;
      setAuthenticated(false);
      setPassword('');
      setError('Сессия завершилась. Войдите снова — открытый черновик останется на месте.');
    };
    const focus = () => { void check(); };
    const interval = window.setInterval(focus, 60_000);
    window.addEventListener(authRequiredEvent, expired);
    window.addEventListener('focus', focus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(authRequiredEvent, expired);
      window.removeEventListener('focus', focus);
    };
  }, [check]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    authVersion.current++;
    try {
      const result = await loginApp({ username, password }, { credentials: 'same-origin' });
      if (!result.authenticated) throw new Error('Session was not established');
      authVersion.current++;
      setPassword('');
      setAuthenticated(true);
      if (opened) onResume();
      setOpened(true);
    } catch (cause) {
      setPassword('');
      setError(errorMessage(cause, 'Не удалось войти. Проверьте соединение и попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    authVersion.current++;
    try {
      await logoutApp({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      authVersion.current++;
      setOpened(false);
      setAuthenticated(false);
      setUsername('');
      setPassword('');
      setError('');
      onLogout();
    } finally {
      setBusy(false);
    }
  }

  return <AuthContext.Provider value={{ logout, busy }}>
    {/* Retain the mounted planner on expiry so unsaved edits survive reauthentication. */}
    {opened && <div hidden={!authenticated}>{children}</div>}
    {!authenticated && <main className="fixed inset-0 z-[200] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-[#f5f2e9] p-5 text-[#293640]">
      <section className="panel w-full max-w-md rounded-xl p-7 shadow-lg sm:p-9" aria-labelledby="app-login-heading">
        <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#f3e4db] text-[#bd4c2b]"><Factory size={25} /></div>
        <p className="mb-2 text-xs font-semibold text-[#777b78]">Планировщик проектов</p>
        <h1 id="app-login-heading" className="display-font text-2xl font-semibold">Вход в приложение</h1>
        {checking ? <p role="status" className="mt-5 text-sm text-[#777b78]">Проверка доступа…</p> : <>
          <p className="mt-2 text-sm text-[#777b78]">Введите логин и пароль для доступа к проектам.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="app-login" className="mb-1.5 block text-xs font-bold">Логин</label>
              <input id="app-login" name="username" autoComplete="username" required maxLength={200} value={username} onChange={event => setUsername(event.target.value)} className="control h-11 w-full px-3 text-sm" disabled={busy || !configured} />
            </div>
            <div>
              <label htmlFor="app-password" className="mb-1.5 block text-xs font-bold">Пароль</label>
              <input id="app-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} className="control h-11 w-full px-3 text-sm" disabled={busy || !configured} />
            </div>
            {error && <p role="alert" className="rounded-md border border-[#e5b9ad] bg-[#f8eae5] p-3 text-xs text-[#a5432d]">{error}</p>}
            <button type="submit" disabled={busy || !configured} className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-md text-sm font-bold disabled:opacity-50"><LockKeyhole size={15} />{busy ? 'Вход…' : 'Войти'}</button>
          </form>
          <button type="button" onClick={() => void check()} disabled={busy} className="mt-4 text-xs font-semibold text-[#777b78] hover:underline">Повторить проверку подключения</button>
        </>}
      </section>
    </main>}
  </AuthContext.Provider>;
}
