import { useState } from 'react';
import { getAccountEmail } from '../api';
import AuthGate from './AuthGate';

interface Props {
  children: React.ReactNode;
}

/**
 * Login/register is now the first step to using Piitrade Videos at
 * all — this wraps every consumer route (everything except /admin/*,
 * which has its own separate AdminAuthProvider) and shows AuthGate
 * until getAccountEmail() says this browser has a signed-in account.
 * That flag is set by AuthGate on successful login/signup and persists
 * in localStorage, so this only actually gates the FIRST visit; every
 * return visit from the same browser goes straight through.
 */
export default function RequireConsumerAuth({ children }: Props) {
  const [authed, setAuthed] = useState(() => !!getAccountEmail());

  if (!authed) {
    return <AuthGate onAuthenticated={() => setAuthed(true)} />;
  }

  return <>{children}</>;
}
