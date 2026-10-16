/**
 * Shapes for the transport block on the sale and invoice forms.
 *
 * Kept out of TransportFields.jsx because that file exports components, and a
 * module that exports both components and plain functions breaks fast refresh.
 * The reason they are shared at all is the same one as the component: two
 * copies of eight fields is how one screen starts sending a key the other does
 * not.
 */

/** A blank transport group, so both screens start from the same shape. */
export const blankTransport = () => ({
  transporterName: "",
  transporterId: "",
  transportMode: "",
  vehicleNumber: "",
  transportDocNumber: "",
  transportDocDate: "",
  grNumber: "",
  grDate: "",
});

/** Reads a saved row back into the form's shape. Dates come back as timestamps. */
export const transportFromRow = (row = {}) => ({
  transporterName: row.transporter_name || "",
  transporterId: row.transporter_id || "",
  transportMode: row.transport_mode || "",
  vehicleNumber: row.vehicle_number || "",
  transportDocNumber: row.transport_doc_number || "",
  transportDocDate: row.transport_doc_date ? String(row.transport_doc_date).slice(0, 10) : "",
  grNumber: row.gr_number || "",
  grDate: row.gr_date ? String(row.gr_date).slice(0, 10) : "",
});

/** Did anybody actually fill any of it in? */
export const hasTransport = (value = {}) =>
  Object.values(value).some((v) => String(v || "").trim() !== "");
