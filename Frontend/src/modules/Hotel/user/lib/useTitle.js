import { useEffect } from "react";

const DEFAULT_DESCRIPTION =
  "Book verified hotels, resorts, villas and homestays with KSG Stays. Live prices, free cancellation on many stays, pay at hotel or online.";

/** Set (or create) one <meta>; returns a function that puts it back as it was. */
function setMeta(attr, key, value) {
  if (typeof document === "undefined" || value == null || value === "") return () => {};
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  const created = !el;
  const previous = el?.getAttribute("content") ?? null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", String(value));
  return () => {
    if (created) el.remove();
    else el.setAttribute("content", previous ?? "");
  };
}

const absoluteUrl = (value) => {
  if (!value) return "";
  try {
    return new URL(value, window.location.origin).href;
  } catch {
    return "";
  }
};

/**
 * Page title plus basic SEO / share tags for the hotel screens.
 *   useTitle("My stays", { noindex: true })
 *   useTitle(property.name, { description, image, type: "hotel" })
 * Everything it changes is restored on unmount, so the rest of the app keeps the
 * site-wide tags from index.html.
 */
export default function useTitle(title, { description, image, type = "website", noindex = false } = {}) {
  useEffect(() => {
    if (!title) return undefined;
    const full = `${title} | KSG Stays`;
    const previousTitle = document.title;
    document.title = full;
    const desc = String(description || DEFAULT_DESCRIPTION).replace(/\s+/g, " ").trim().slice(0, 300);
    const restore = [
      setMeta("name", "description", desc),
      setMeta("property", "og:title", full),
      setMeta("property", "og:description", desc),
      setMeta("property", "og:type", type),
      setMeta("property", "og:url", window.location.href.split("#")[0]),
      setMeta("property", "og:image", absoluteUrl(image)),
      setMeta("name", "twitter:card", image ? "summary_large_image" : "summary"),
      noindex ? setMeta("name", "robots", "noindex, nofollow") : () => {},
    ];
    return () => {
      document.title = previousTitle;
      restore.forEach((fn) => fn());
    };
  }, [title, description, image, type, noindex]);
}
