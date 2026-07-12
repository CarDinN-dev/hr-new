export function dataUrlBlob(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const metadata = dataUrl.slice(5, comma).split(";");
  const payload = dataUrl.slice(comma + 1);
  if (!dataUrl.startsWith("data:") || comma < 6 || metadata.at(-1) !== "base64" || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
    throw new Error("Saved PDF data is invalid.");
  }
  const bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0));
  return new Blob([bytes], { type: metadata[0] });
}

export function openDataUrl(dataUrl: string) {
  const url = URL.createObjectURL(dataUrlBlob(dataUrl));
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
