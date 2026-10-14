import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Run `fn` when `deps` change; ignore responses from superseded calls.
 * Returns { data, loading, error (server message), reload, setData }.
 */
export function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === seq.current) setData(result ?? null);
    } catch (err) {
      if (id === seq.current) setError(err?.message || "Something went wrong.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: run, setData };
}
