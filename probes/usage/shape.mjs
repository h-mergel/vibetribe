const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
const SHORT_ENUM = /^[A-Za-z_]{1,12}$/;

export function describeShape(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (ISO.test(value)) return "<iso-date>";
    if (SHORT_ENUM.test(value)) return value;
    return `<string ${value.length}>`;
  }
  if (Array.isArray(value)) return value.map(describeShape);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, describeShape(v)]));
}
