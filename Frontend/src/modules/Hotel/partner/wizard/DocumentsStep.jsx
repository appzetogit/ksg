import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { DOCUMENT_HINTS, DOCUMENT_LABELS, OPTIONAL_DOCUMENTS, labelOf } from "../lib/constants";
import { Card, InlineError } from "../components/ui";
import { FileUpload } from "../components/uploads";

/**
 * docs: [{ type, name?, fileUrl }]. Required types get one slot each; anything else
 * is an "additional document" row the partner can add or remove.
 */
export default function DocumentsStep({ docs, setDocs, requiredTypes, errors, verification }) {
  const required = requiredTypes || [];
  const slot = (type) => docs.find((d) => d.type === type && !d._extra);
  const setRequired = (type, fileUrl) => {
    const rest = docs.filter((d) => d.type !== type || d._extra);
    setDocs([...rest, { type, fileUrl }]);
  };
  const extras = docs.map((d, i) => ({ ...d, i })).filter((d) => d._extra || !required.includes(d.type));
  const extraTypes = [...OPTIONAL_DOCUMENTS, "trade_license", "rent_agreement", "electricity_bill"].filter(
    (t, idx, arr) => !required.includes(t) && arr.indexOf(t) === idx,
  );

  const updateAt = (i, patch) => setDocs(docs.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="space-y-6">
      <div className="flex gap-3 rounded-2xl bg-blue-50/70 p-4 text-sm text-[#0B2A6F]">
        <ShieldCheck className="h-5 w-5 shrink-0" />
        <p>
          These prove you can run guests at this address. They are stored privately and only the KSG verification team
          can open them.
        </p>
      </div>

      {verification?.status && verification.status !== "pending" && (
        <p
          className={`rounded-xl px-3 py-2 text-sm ${
            verification.status === "verified" ? "bg-green-50 text-green-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          Documents {verification.status}
          {verification.remark ? `: ${verification.remark}` : ""}
        </p>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Required for this property</h3>
        {required.length === 0 ? (
          <p className="text-sm text-slate-500">No documents are required for this property type.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {required.map((type) => (
              <FileUpload
                key={type}
                label={labelOf(DOCUMENT_LABELS, type)}
                hint={DOCUMENT_HINTS[type]}
                required
                folder="documents"
                value={slot(type)?.fileUrl || ""}
                onChange={(url) => setRequired(type, url)}
                error={errors[`doc.${type}`]}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Additional documents <span className="font-normal text-slate-400">(optional)</span>
          </h3>
          <button
            type="button"
            onClick={() => setDocs([...docs, { type: extraTypes[0] || "other", name: "", fileUrl: "", _extra: true }])}
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#E85D04] hover:underline"
          >
            <Plus className="h-4 w-4" /> Add document
          </button>
        </div>
        {extras.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
            Fire NOC, GST certificate or anything else that helps us verify faster.
          </p>
        ) : (
          <ul className="space-y-3">
            {extras.map((d) => (
              <li key={d.i}>
                <Card className="grid gap-3 p-3 md:grid-cols-[200px_1fr_auto] md:items-start">
                  <div className="space-y-2">
                    <label className="sr-only" htmlFor={`doc-type-${d.i}`}>
                      Document type
                    </label>
                    <select
                      id={`doc-type-${d.i}`}
                      value={d.type}
                      onChange={(e) => updateAt(d.i, { type: e.target.value })}
                      className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                    >
                      {extraTypes.map((t) => (
                        <option key={t} value={t}>
                          {labelOf(DOCUMENT_LABELS, t)}
                        </option>
                      ))}
                    </select>
                    {d.type === "other" && (
                      <input
                        aria-label="Document name"
                        placeholder="Document name"
                        value={d.name || ""}
                        onChange={(e) => updateAt(d.i, { name: e.target.value })}
                        className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
                      />
                    )}
                  </div>
                  <FileUpload folder="documents" value={d.fileUrl} onChange={(url) => updateAt(d.i, { fileUrl: url })} />
                  <button
                    type="button"
                    aria-label="Remove document"
                    onClick={() => setDocs(docs.filter((_, j) => j !== d.i))}
                    className="flex h-10 w-10 items-center justify-center justify-self-end rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {Object.keys(errors).some((k) => k.startsWith("doc.") && errors[k]) && (
        <InlineError message="Upload every required document to continue." />
      )}
    </div>
  );
}

/** What PUT /partner/properties/:id/documents receives. */
export const documentsPayload = (docs) => ({
  documents: docs
    .filter((d) => d.fileUrl)
    .map((d) => ({ type: d.type, ...(d.name ? { name: d.name } : {}), fileUrl: d.fileUrl })),
});
