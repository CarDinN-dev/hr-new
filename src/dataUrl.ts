export function dataUrlBlob(dataUrl: string) {
  const maxDecodedBytes = 10_000_000;
  const comma = dataUrl.indexOf(",");
  const metadata = dataUrl.slice(5, comma).split(";");
  const payload = dataUrl.slice(comma + 1);
  if (
    !dataUrl.startsWith("data:") ||
    comma < 6 ||
    metadata[0]?.toLowerCase() !== "application/pdf" ||
    metadata.at(-1)?.toLowerCase() !== "base64" ||
    !/^[A-Za-z0-9+/=]+$/.test(payload) ||
    Math.ceil(payload.length * 0.75) > maxDecodedBytes
  ) {
    throw new Error("Saved PDF data is invalid.");
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0));
  } catch {
    throw new Error("Saved PDF data is invalid.");
  }
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("Saved PDF data is invalid.");
  }
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: "application/pdf" });
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
