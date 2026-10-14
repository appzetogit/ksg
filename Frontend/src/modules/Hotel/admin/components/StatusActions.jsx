import { useState } from "react";
import { toast } from "sonner";
import { Button, ConfirmDialog } from "./ui";

/**
 * Status change buttons with a confirm dialog each. `actions` is a list of
 * { status, label, tone, icon, reasonRequired, title, message, success }; the one
 * matching `current` is hidden. `onChange(status, reason)` performs the call.
 */
export default function StatusActions({ current, actions, onChange, disabled }) {
  const [pending, setPending] = useState(null);
  const visible = actions.filter((a) => a.status !== current && (!a.when || a.when(current)));

  const confirm = async (reason) => {
    try {
      await onChange(pending.status, reason);
      toast.success(pending.success || "Status updated");
    } catch (err) {
      toast.error(err?.message || "Could not update the status");
      throw err;
    }
  };

  if (visible.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {visible.map((a) => (
          <Button key={a.status} tone={a.tone} icon={a.icon} disabled={disabled} onClick={() => setPending(a)}>
            {a.label}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.title}
        message={pending?.message}
        confirmLabel={pending?.label}
        tone={pending?.tone === "ghost" ? "primary" : pending?.tone}
        reason={Boolean(pending?.reasonRequired || pending?.reasonOptional)}
        reasonRequired={Boolean(pending?.reasonRequired)}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </>
  );
}
