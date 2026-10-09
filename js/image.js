/** Shrinks a photo to max 1600px JPEG so uploads are small and cheap to read. Returns { blob, base64, mime }. */
export async function downscaleImage(file, max = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("That file isn't a picture this browser can open.");
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
  const base64 = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
  return { blob, base64, mime: "image/jpeg" };
}
