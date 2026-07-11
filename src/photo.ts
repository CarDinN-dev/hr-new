const supportedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxPhotoBytes = 8_000_000;
const outputSize = 512;

export function photoFileError(file: Pick<File, "type" | "size">) {
  if (!supportedPhotoTypes.has(file.type)) return "Choose a JPEG, PNG or WebP image.";
  if (file.size > maxPhotoBytes) return "Choose an image under 8 MB.";
  return "";
}

export async function preparePhoto(file: File) {
  const error = photoFileError(file);
  if (error) throw new Error(error);

  const bitmap = await createImageBitmap(file);
  if (!bitmap.width || !bitmap.height) {
    bitmap.close();
    throw new Error("The selected image could not be decoded.");
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Photo processing is unavailable in this browser.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, outputSize, outputSize);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, outputSize, outputSize);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.84);
}
