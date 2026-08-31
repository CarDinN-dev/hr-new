export function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[\t\r\n ]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
