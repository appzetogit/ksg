import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, Search } from "lucide-react";
import { BTN, StateMessage } from "../components/ui";
import useTitle from "../lib/useTitle";

// TODO(booking phase): list and toggle saved properties once the saved-properties API
// lands (hotel_saved_properties collection already exists on the backend).
export default function SavedPage() {
  useTitle("Saved stays");
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold text-slate-900">Saved stays</h1>
      <p className="mt-1 text-sm text-slate-500">Shortlist places you love and book them later.</p>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <StateMessage
          icon={Heart}
          tone="saffron"
          title="Nothing saved yet"
          message="Saving stays is coming soon. Until then, share a stay's link with yourself to come back to it."
        >
          <Link to="/hotel" className={BTN.primary}>
            <Search className="h-4 w-4" aria-hidden="true" /> Explore stays
          </Link>
        </StateMessage>
      </motion.div>
    </div>
  );
}
