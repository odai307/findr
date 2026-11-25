import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthChange, refreshSession } from './api';

type Status = 'loading' | 'signed-in' | 'signed-out';

const AuthContext = createContext<Status>('loading');

/** On first load, tries the refresh cookie to restore the session, then tracks sign-in changes. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const unsubscribe = onAuthChange((signedIn) =>
      setStatus(signedIn ? 'signed-in' : 'signed-out'),
    );
    void refreshSession();
    return () => {
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={status}>{children}</AuthContext.Provider>;
}

export function useAuthStatus() {
  return useContext(AuthContext);
}
