import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Building2, CheckCircle2, ChevronRight, RotateCcw, XCircle } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { formatDate, fullAddress, label, masked } from "../format";
import StatusActions from "../components/StatusActions";
import { useHotelAccess } from "../hotelAccess";
import { Card, DetailSkeleton, EmptyState, ErrorState, Fields, FileTile, LiveBadge, PageHeader, StatusBadge } from "../components/ui";

const ACTIONS = [
  {
    status: "approved",
    label: "Approve",
    tone: "success",
    icon: CheckCircle2,
    title: "Approve this partner?",
    message: "They can then list properties and receive bookings. Check KYC and bank details first.",
    success: "Partner approved",
  },
  {
    status: "rejected",
    label: "Reject",
    tone: "danger",
    icon: XCircle,
    reasonRequired: true,
    title: "Reject this partner?",
    message: "The partner sees the reason and can correct their details.",
    success: "Partner rejected",
  },
  {
    status: "blocked",
    label: "Block",
    tone: "danger",
    icon: Ban,
    reasonRequired: true,
    title: "Block this partner?",
    message: "They lose access to the partner app and their properties stop taking bookings.",
    success: "Partner blocked",
  },
  {
    status: "pending",
    label: "Move to pending",
    tone: "ghost",
    icon: RotateCcw,
    title: "Move back to pending?",
    message: "The partner returns to the approval queue.",
    success: "Moved back to pending",
  },
];

export const BackLink = ({ to, children }) => (
  <Link to={to} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--ha-ink-soft)] hover:text-[var(--ha-navy)]">
    <ArrowLeft className="h-4 w-4" />
    {children}
  </Link>
);

export default function PartnerDetail() {
  const { canWrite } = useHotelAccess();
  const { id } = useParams();
  const { data, loading, error, reload } = useLoad(() => hotelAdmin.partner(id), [id]);
  const partner = data?.partner;
  const properties = Array.isArray(data?.properties) ? data.properties : [];
  const back = <BackLink to="/admin/hotel/partners">Partners</BackLink>;

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Partner" back={back} />
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      </div>
    );
  }
  if (loading && !partner) return <div className="mx-auto max-w-6xl"><DetailSkeleton /></div>;
  if (!partner) return null;

  const kyc = partner.kyc || {};
  const bank = partner.bank || {};

  const changeStatus = async (status, reason) => {
    await hotelAdmin.setPartnerStatus(id, status, reason);
    await reload();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {partner.name || "Unnamed partner"}
            <StatusBadge status={partner.status} />
          </span>
        }
        subtitle={`Joined ${formatDate(partner.createdAt)} · ${partner.phone || "no phone"}`}
        actions={
          canWrite("hotel_partners") ? (
            <StatusActions current={partner.status} actions={ACTIONS} onChange={changeStatus} disabled={loading} />
          ) : null
        }
      />

      {partner.rejectionReason && ["rejected", "blocked"].includes(partner.status) && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">{label(partner.status)} reason:</span> {partner.rejectionReason}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Profile">
          <Fields
            rows={[
              ["Name", partner.name],
              ["Phone", partner.phone],
              ["Email", partner.email],
              ["Terms accepted", partner.termsAcceptedAt ? formatDate(partner.termsAcceptedAt, true) : "Not yet"],
              ["Last updated", formatDate(partner.updatedAt, true)],
            ]}
          />
        </Card>
        <Card title="Address">
          <Fields
            rows={[
              ["Address", partner.address?.line],
              ["City", partner.address?.city],
              ["State", partner.address?.state],
              ["Pincode", partner.address?.pincode],
            ]}
          />
        </Card>
      </div>

      <Card title="KYC">
        <Fields
          rows={[
            ["Owner name", kyc.ownerName],
            ["Aadhaar", kyc.aadhaarNumberMasked ? masked(kyc.aadhaarNumberMasked) : null],
            ["PAN", kyc.panNumber],
            ["GST", kyc.gstNumber || "Not registered"],
          ]}
        />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <FileTile url={kyc.aadhaarFront} title="Aadhaar front" />
          <FileTile url={kyc.aadhaarBack} title="Aadhaar back" />
          <FileTile url={kyc.panImage} title="PAN card" />
          {(kyc.gstNumber || kyc.gstCertificate) && <FileTile url={kyc.gstCertificate} title="GST certificate" />}
        </div>
        <p className="mt-3 text-xs text-[var(--ha-ink-faint)]">Document links are signed and expire; reload the page if one stops opening.</p>
      </Card>

      <Card title="Bank account">
        <Fields
          rows={[
            ["Account holder", bank.accountHolder],
            ["Account number", bank.accountNumberMasked ? masked(bank.accountNumberMasked) : null],
            ["IFSC", bank.ifsc],
            ["Bank", bank.bankName],
          ]}
        />
      </Card>

      <Card title={`Properties (${properties.length})`} bodyClassName="p-0">
        {properties.length === 0 ? (
          <EmptyState icon={Building2} title="No properties yet" message="This partner has not listed a property." />
        ) : (
          <ul className="divide-y divide-[var(--ha-border)]">
            {properties.map((p) => (
              <li key={p._id}>
                <Link to={`/admin/hotel/properties/${p._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--ha-hover)]">
                  {p.coverImage ? (
                    <img src={p.coverImage} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-[var(--ha-surface)]">
                      <Building2 className="h-5 w-5 text-[var(--ha-ink-faint)]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[var(--ha-ink)]">{p.name}</p>
                    <p className="truncate text-xs text-[var(--ha-ink-faint)]">
                      {label(p.propertyType)} · {fullAddress(p.address)}
                    </p>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    <StatusBadge status={p.status} />
                    {p.status === "approved" && <LiveBadge isLive={p.isLive} />}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ha-ink-faint)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
