import { CANCELLATION_DEFAULTS, TYPE_DETAIL_FIELDS } from "../lib/constants";
import { compact, num, onlyDigits } from "../lib/utils";

/**
 * The property wizard's data model: steps, how a Property maps to the form, what
 * each step sends to the API, and what each step must have before moving on.
 */

export const STEPS = [
  { key: "type", label: "Type", title: "What kind of property is it?" },
  { key: "basics", label: "Basics", title: "Tell guests about your property" },
  { key: "location", label: "Location", title: "Where is it?" },
  { key: "photos", label: "Photos", title: "Add photos" },
  { key: "policies", label: "Amenities & rules", title: "Amenities, rules and policies" },
  { key: "rooms", label: "Rooms", title: "Rooms and prices" },
  { key: "documents", label: "Documents", title: "Property documents" },
  { key: "review", label: "Review", title: "Review and submit" },
];

export const stepIndex = (key) => Math.max(0, STEPS.findIndex((s) => s.key === key));

export const MIN_PHOTOS = 3;

export const emptyForm = (partner) => ({
  propertyType: "",
  name: "",
  typeDetails: {},
  suitability: "none",
  shortDescription: "",
  description: "",
  contactNumber: partner?.phone || "",
  address: { line1: "", area: "", city: "", state: "", pincode: "", country: "India" },
  location: null,
  nearbyPlaces: [],
  photos: [], // cover first
  coverImage: "",
  amenities: [],
  houseRules: [],
  checkInTime: "12:00",
  checkOutTime: "11:00",
  cancellationPolicy: { type: "moderate", ...CANCELLATION_DEFAULTS.moderate },
});

export const propertyToForm = (p, partner) => {
  const base = emptyForm(partner);
  if (!p) return base;
  const coords = p.location?.coordinates;
  const cover = p.coverImage || "";
  const gallery = (p.images || []).filter((u) => u && u !== cover);
  return {
    ...base,
    propertyType: p.propertyType || "",
    name: p.name || "",
    typeDetails: { ...(p.typeDetails || {}) },
    suitability: p.suitability || "none",
    shortDescription: p.shortDescription || "",
    description: p.description || "",
    contactNumber: p.contactNumber || base.contactNumber,
    address: { ...base.address, ...(p.address || {}) },
    location:
      Array.isArray(coords) && coords.length === 2 && (coords[0] || coords[1])
        ? { lat: Number(coords[1]), lng: Number(coords[0]) }
        : null,
    nearbyPlaces: (p.nearbyPlaces || []).map((n) => ({ name: n.name || "", type: n.type || "other", distanceKm: n.distanceKm ?? "" })),
    photos: cover ? [cover, ...gallery] : gallery,
    coverImage: cover,
    amenities: [...(p.amenities || [])],
    houseRules: [...(p.houseRules || [])],
    checkInTime: p.checkInTime || base.checkInTime,
    checkOutTime: p.checkOutTime || base.checkOutTime,
    cancellationPolicy: { ...base.cancellationPolicy, ...(p.cancellationPolicy || {}) },
  };
};

/** Only the type-detail keys that belong to the chosen type. */
const typeDetailsFor = (type, details = {}) => {
  const out = {};
  (TYPE_DETAIL_FIELDS[type] || []).forEach(({ key, kind }) => {
    const v = details[key];
    if (v === undefined || v === "" || v === null) return;
    out[key] = kind === "stars" ? Number(v) : kind === "toggle" ? Boolean(v) : v;
  });
  return out;
};

/** The request body for a step (what PUT /partner/properties/:id receives). */
export const payloadFor = (step, f) => {
  switch (step) {
    case "type":
      return { propertyType: f.propertyType, typeDetails: typeDetailsFor(f.propertyType, f.typeDetails) };
    case "basics":
      return compact({
        propertyType: f.propertyType,
        name: f.name,
        typeDetails: typeDetailsFor(f.propertyType, f.typeDetails),
        suitability: f.suitability || "none",
        shortDescription: f.shortDescription,
        description: f.description,
        contactNumber: onlyDigits(f.contactNumber, 10),
      });
    case "location": {
      const a = f.address || {};
      const fullAddress = [a.line1, a.area, a.city, a.state, a.pincode].filter(Boolean).join(", ");
      return {
        address: compact({ ...a, country: a.country || "India", fullAddress }),
        ...(f.location ? { location: { lat: f.location.lat, lng: f.location.lng } } : {}),
        nearbyPlaces: (f.nearbyPlaces || [])
          .filter((n) => n.name?.trim())
          .map((n) => ({ name: n.name.trim(), type: n.type || "other", distanceKm: num(n.distanceKm, 0) })),
      };
    }
    case "photos": {
      const cover = f.coverImage || f.photos[0] || "";
      return { coverImage: cover, images: f.photos.filter((u) => u !== cover) };
    }
    case "policies":
      return {
        amenities: f.amenities,
        houseRules: f.houseRules.map((r) => r.trim()).filter(Boolean),
        checkInTime: f.checkInTime,
        checkOutTime: f.checkOutTime,
        cancellationPolicy: {
          type: f.cancellationPolicy.type,
          freeCancelHours: num(f.cancellationPolicy.freeCancelHours, 0),
          refundPercentAfter: num(f.cancellationPolicy.refundPercentAfter, 0),
        },
      };
    default:
      return null;
  }
};

/** Field errors for a step; empty object when it can move on. */
export const validateStep = (step, f, ctx = {}) => {
  const e = {};
  if (step === "type") {
    if (!f.propertyType) e.propertyType = "Choose a property type";
  }
  if (step === "basics") {
    if (!f.name.trim() || f.name.trim().length < 3) e.name = "Enter the property name (at least 3 characters)";
    if (!f.shortDescription.trim()) e.shortDescription = "Add a one-line summary";
    if (f.description.trim().length < 30) e.description = "Describe the property in at least 30 characters";
    const phone = onlyDigits(f.contactNumber);
    if (phone && phone.length !== 10) e.contactNumber = "Enter a 10-digit number";
    (TYPE_DETAIL_FIELDS[f.propertyType] || []).forEach(({ key, kind, label }) => {
      if (kind === "select" && !f.typeDetails?.[key]) e[`typeDetails.${key}`] = `Choose ${label.toLowerCase()}`;
    });
  }
  if (step === "location") {
    if (!f.address.city?.trim()) e.city = "Enter the city";
    if (!f.address.line1?.trim()) e.line1 = "Enter the street address";
    if (f.address.pincode && !/^\d{6}$/.test(f.address.pincode)) e.pincode = "Pincode is 6 digits";
    if (!f.location) e.location = "Drop a pin on the map, or use your location";
  }
  if (step === "photos") {
    if (f.photos.length < MIN_PHOTOS) e.photos = `Add at least ${MIN_PHOTOS} photos (you have ${f.photos.length})`;
  }
  if (step === "policies") {
    if (!f.checkInTime) e.checkInTime = "Set a check-in time";
    if (!f.checkOutTime) e.checkOutTime = "Set a check-out time";
    const pct = num(f.cancellationPolicy.refundPercentAfter, 0);
    if (pct < 0 || pct > 100) e.refundPercentAfter = "Between 0 and 100";
  }
  if (step === "rooms") {
    if (!(ctx.roomTypes || []).some((r) => r.isActive !== false)) e.rooms = "Add at least one room type";
  }
  if (step === "documents") {
    const have = new Set((ctx.docs || []).filter((d) => d.fileUrl).map((d) => d.type));
    (ctx.requiredTypes || []).forEach((t) => {
      if (!have.has(t)) e[`doc.${t}`] = "Required";
    });
  }
  return e;
};

export const hasErrors = (e) => Object.values(e).some(Boolean);
