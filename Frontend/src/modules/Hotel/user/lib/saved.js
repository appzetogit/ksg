import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listSaved, setSaved } from "./bookingApi";
import { getUserToken, loginRedirect } from "./session";

// Saved (wishlisted) property ids, shared by every heart on the page. Loaded once from
// GET /user/saved when a logged-in visitor first sees a heart; toggles are optimistic.

let ids = new Set();
let loadedFor = ""; // token the set was loaded with
let loading = null;
const pending = new Set();
const listeners = new Set();
let version = 0;

const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => version;

const ensureLoaded = () => {
  const token = getUserToken();
  if (!token) {
    if (loadedFor) {
      ids = new Set();
      loadedFor = "";
      emit();
    }
    return;
  }
  if (loadedFor === token || loading) return;
  loading = listSaved()
    .then((items) => {
      ids = new Set(items.map((p) => String(p?._id || p?.propertyId || p)).filter(Boolean));
      loadedFor = token;
      emit();
    })
    .catch(() => {
      /* hearts stay empty; a toggle still works */
    })
    .finally(() => {
      loading = null;
    });
};

/** Seed from a fresh /user/saved response (the Saved page) so hearts agree with it. */
export const primeSaved = (items) => {
  ids = new Set(items.map((p) => String(p?._id)).filter(Boolean));
  loadedFor = getUserToken();
  emit();
};

export const isSaved = (id) => ids.has(String(id));
export const savedReady = () => Boolean(loadedFor) && loadedFor === getUserToken();

/** Re-render the caller whenever any saved state changes. */
export function useSavedStore() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * `{ saved, busy, error, toggle }` for one property. Logged-out visitors are sent to
 * login and come back to the current page.
 */
export function useSavedProperty(propertyId) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const id = String(propertyId || "");

  useEffect(() => {
    ensureLoaded();
  }, []);

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(""), 3500);
    return () => clearTimeout(t);
  }, [error]);

  const toggle = useCallback(async () => {
    if (!id || pending.has(id)) return;
    if (!getUserToken()) {
      loginRedirect(navigate, `${location.pathname}${location.search}`);
      return;
    }
    const next = !ids.has(id);
    pending.add(id);
    if (next) ids.add(id);
    else ids.delete(id);
    emit();
    setError("");
    try {
      const saved = await setSaved(id, next);
      if (saved) ids.add(id);
      else ids.delete(id);
    } catch (err) {
      if (next) ids.delete(id);
      else ids.add(id);
      setError(err.status === 401 ? "Please log in again to save stays." : err.message);
    } finally {
      pending.delete(id);
      emit();
    }
  }, [id, navigate, location.pathname, location.search]);

  return { saved: ids.has(id), busy: pending.has(id), error, toggle };
}
