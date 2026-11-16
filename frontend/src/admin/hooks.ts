import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs `fn` whenever `deps` change; ignores stale responses so fast typing/paging can't show old data. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const seq = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => {
        if (id === seq.current) setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (id === seq.current) setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Something went wrong' }));
      });
  }, deps);

  useEffect(run, [run]);
  return { ...state, reload: run };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
