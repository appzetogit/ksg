import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * List filters kept in the URL, so a filtered list survives reload, back from a
 * detail page, and can be linked to (the dashboard's queue links do).
 * Changing any filter other than `page` resets to page 1.
 */
export function useListParams(defaults) {
  const [search, setSearch] = useSearchParams();
  const params = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const v = search.get(key);
      if (v !== null) out[key] = key === "page" ? Math.max(1, Number(v) || 1) : v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const update = useCallback(
    (patch) => {
      const next = { ...params, ...patch };
      if (!("page" in patch)) next.page = 1;
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(next)) {
        if (v !== undefined && v !== null && v !== "" && String(v) !== String(defaults[k])) qs.set(k, String(v));
      }
      setSearch(qs, { replace: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, setSearch],
  );

  return [params, update];
}
