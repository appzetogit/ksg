import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, LogIn, Search, ServerCrash } from "lucide-react";
import { ResultCard, ResultCardSkeleton } from "../components/PropertyCard";
import { BTN, StateMessage, stagger } from "../components/ui";
import { getCatalogue } from "../lib/api";
import { listSaved } from "../lib/bookingApi";
import { isSaved, primeSaved, savedReady, useSavedStore } from "../lib/saved";
import { getUserToken, loginRedirect } from "../lib/session";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

const Panel = ({ children }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/70">
    {children}
  </motion.div>
);

function Empty() {
  return (
    <Panel>
      <StateMessage icon={Heart} tone="saffron" title="Nothing saved yet" message="Tap the heart on any stay to shortlist it here and book it later.">
        <Link to="/hotel" className={BTN.primary}>
          <Search className="h-4 w-4" aria-hidden="true" /> Explore stays
        </Link>
      </StateMessage>
    </Panel>
  );
}

export default function SavedPage() {
  useTitle("Saved stays", { noindex: true });
  const navigate = useNavigate();
  const token = getUserToken();
  const res = useAsync(listSaved, "saved", { enabled: Boolean(token) });
  const catalogue = useAsync(getCatalogue, "catalogue");
  useSavedStore(); // unsaved stays drop off the list as soon as their heart is toggled

  useEffect(() => {
    if (res.data) primeSaved(res.data);
  }, [res.data]);

  const ready = savedReady();
  const items = (res.data || []).filter((p) => !ready || isSaved(p._id));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold text-slate-900">Saved stays</h1>
      <p className="mt-1 text-sm text-slate-500">Shortlist places you love and book them later.</p>

      {!token ? (
        <Panel>
          <StateMessage icon={LogIn} title="Log in to see saved stays" message="Your shortlist is linked to your KSG account.">
            <button type="button" onClick={() => loginRedirect(navigate, "/hotel/saved")} className={BTN.navy}>
              Log in
            </button>
          </StateMessage>
        </Panel>
      ) : res.loading && !res.data ? (
        <div className="mt-6 space-y-4" aria-busy="true" aria-label="Loading saved stays">
          {[0, 1].map((i) => (
            <ResultCardSkeleton key={i} />
          ))}
        </div>
      ) : res.error ? (
        <Panel>
          <StateMessage icon={ServerCrash} tone="red" title="We couldn't load your saved stays" message={res.error.message}>
            {res.error.status === 401 ? (
              <button type="button" onClick={() => loginRedirect(navigate, "/hotel/saved")} className={BTN.navy}>
                Log in again
              </button>
            ) : (
              <button type="button" onClick={res.reload} className={BTN.primary}>
                Try again
              </button>
            )}
          </StateMessage>
        </Panel>
      ) : items.length === 0 ? (
        <Empty />
      ) : (
        <motion.div initial="hidden" animate="show" variants={stagger(0.06)} className="mt-6 space-y-4">
          {items.map((p) => (
            <ResultCard key={p._id} property={p} catalogue={catalogue.data} />
          ))}
        </motion.div>
      )}
    </div>
  );
}
