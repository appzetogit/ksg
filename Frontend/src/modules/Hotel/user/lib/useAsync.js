import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Run an async loader whenever `key` changes. Keeps the previous data while a new
 * request is in flight (no layout jump) and ignores responses that arrive late.
 */
export function useAsync(loader, key, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => loaderRef.current())
      .then(
        (data) => alive && setState({ data, error: null, loading: false }),
        (error) => alive && setState((s) => ({ data: s.data, error, loading: false }))
      );
    return () => {
      alive = false;
    };
  }, [key, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export default useAsync;
