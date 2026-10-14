import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { SmartImage, cx, useScrollLock } from "./ui";

const slide = {
  enter: (dir) => ({ opacity: 0, x: dir * 40 }),
  center: { opacity: 1, x: 0 },
  exit: (dir) => ({ opacity: 0, x: dir * -40 }),
};

export function Lightbox({ images, index, onClose, onIndex, title }) {
  const open = index !== null;
  const [dir, setDir] = useState(1);
  const closeRef = useRef(null);
  useScrollLock(open);

  const go = useCallback(
    (delta) => {
      setDir(delta);
      onIndex((i) => (i + delta + images.length) % images.length);
    },
    [images.length, onIndex]
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex flex-col bg-black/95 ksg-hotel text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={`${title} photos`}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-white/70 tabular-nums">
              {index + 1} / {images.length}
            </span>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close photos" className="rounded-full p-2 hover:bg-white/10">
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2 sm:px-16">
            <AnimatePresence initial={false} custom={dir} mode="popLayout">
              <motion.img
                key={images[index]}
                src={images[index]}
                alt={`${title} photo ${index + 1}`}
                custom={dir}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -60) go(1);
                  else if (info.offset.x > 60) go(-1);
                }}
                className="max-h-full max-w-full select-none rounded-lg object-contain"
                draggable={false}
              />
            </AnimatePresence>
            {images.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 hover:bg-white/20 sm:block">
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 p-3 hover:bg-white/20 sm:block">
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => {
                  setDir(i > index ? 1 : -1);
                  onIndex(i);
                }}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === index}
                className={cx("h-14 w-20 shrink-0 overflow-hidden rounded-md transition", i === index ? "ring-2 ring-[#FF7A00]" : "opacity-50 hover:opacity-100")}
              >
                <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// Grid spans so 1-4 photos still fill the 4x2 mosaic without gaps.
const mosaicSpan = (i, n) => {
  if (n === 1) return "col-span-4 row-span-2";
  if (n === 2) return "col-span-2 row-span-2";
  if (i === 0) return "col-span-2 row-span-2";
  if (n === 3) return "col-span-2";
  if (n === 4 && i === 1) return "col-span-2";
  return "";
};

/** Mosaic on desktop, crossfading swipe carousel on phones; both open the lightbox. */
export default function Gallery({ images, title }) {
  const [lightbox, setLightbox] = useState(null);
  const [current, setCurrent] = useState(0);
  const [dir, setDir] = useState(1);
  const list = images.length ? images : [null];
  const step = (delta) => {
    setDir(delta);
    setCurrent((i) => (i + delta + list.length) % list.length);
  };

  return (
    <>
      {/* Phone carousel */}
      <div className="relative -mx-4 aspect-[4/3] overflow-hidden bg-slate-200 sm:hidden">
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={current}
            custom={dir}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            drag={list.length > 1 ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.x < -50) step(1);
              else if (info.offset.x > 50) step(-1);
            }}
            onClick={() => images.length && setLightbox(current)}
          >
            <SmartImage src={list[current]} alt={`${title} photo ${current + 1}`} eager={current === 0} className="h-full w-full" />
          </motion.div>
        </AnimatePresence>
        {images.length > 1 && (
          <>
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
              {current + 1}/{images.length}
            </span>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden="true">
              {images.slice(0, 6).map((_, i) => (
                <span key={i} className={cx("h-1.5 rounded-full bg-white transition-all", i === current % 6 ? "w-5" : "w-1.5 opacity-60")} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Desktop mosaic */}
      <div className="relative hidden h-[420px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-3xl sm:grid">
        {list.slice(0, 5).map((src, i) => (
          <button
            key={src || i}
            type="button"
            onClick={() => src && setLightbox(i)}
            aria-label={`Open photo ${i + 1}`}
            className={cx("group relative overflow-hidden focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300", mosaicSpan(i, Math.min(list.length, 5)))}
          >
            <SmartImage src={src} alt="" eager={i === 0} className="h-full w-full" imgClassName="transition-transform duration-700 group-hover:scale-105" />
            <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
          </button>
        ))}
        {images.length > 1 && (
          <button
            type="button"
            onClick={() => setLightbox(0)}
            className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-xl bg-white/95 px-4 py-2 text-sm font-semibold text-slate-800 shadow-lg transition hover:bg-white"
          >
            <Images className="h-4 w-4" aria-hidden="true" /> Show all {images.length} photos
          </button>
        )}
      </div>

      <Lightbox images={images} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} title={title} />
    </>
  );
}
