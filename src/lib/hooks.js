import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Load data with loading/error state. `load(signal)` runs on mount and when
 * `deps` change; a late response from an outdated request is ignored.
 */
export function useAsync(load, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);

  const reload = useCallback(() => {
    const id = ++run.current;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => load(controller.signal))
      .then((data) => { if (id === run.current) setState({ data, error: null, loading: false }); })
      .catch((error) => {
        if (error?.name === 'AbortError' || id !== run.current) return;
        setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);
  return { ...state, reload };
}

/** Debounce a changing value (e.g. a search box). */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Run an async action with a pending flag; errors are returned, not thrown. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (fn) => {
    setPending(true);
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      return { ok: false, error };
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, run };
}
