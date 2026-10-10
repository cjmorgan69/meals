// Safe fetching of a user-supplied web address (blocks local and private addresses).
// Note: this checks the host name text only. It does not resolve DNS, so a domain that
// points at a private address is not caught here; the edge runtime has no private network.

export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h.includes(":")) return true; // IPv6 literal
  if (h === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return true;
  if (/^[\d.]+$/.test(h) || /(^|\.)0x[0-9a-f]*/i.test(h)) return true; // any IPv4-style literal
  if (!h.includes(".")) return true; // single-label names like "metadata"
  return false;
}

export function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links are supported.");
  if (u.username || u.password) throw new Error("Links with a username or password aren't supported.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("That port isn't supported.");
  if (isBlockedHost(u.hostname)) throw new Error("That address can't be fetched.");
  return u;
}

export async function safeFetchText(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<{ url: string; text: string }> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxRedirects = opts.maxRedirects ?? 4;
  let url = validateUrl(raw);

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; RecipePlannerBot/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new Error("The site redirected without saying where.");
      url = validateUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`The site responded with an error (${res.status}).`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/html|xml|text/i.test(ct)) {
      await res.body?.cancel();
      throw new Error("That link isn't a web page.");
    }
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        break;
      }
    }
    const buf = new Uint8Array(Math.min(total, maxBytes + 65536));
    let off = 0;
    for (const c of chunks) {
      if (off + c.length > buf.length) break;
      buf.set(c, off);
      off += c.length;
    }
    return { url: url.toString(), text: new TextDecoder("utf-8").decode(buf.subarray(0, off)) };
  }
  throw new Error("The link redirected too many times.");
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Resolves a possibly relative address against the page and returns it if it is a fetchable http(s) address. */
export function resolveImageUrl(raw: string | null, pageUrl: string): string | null {
  if (!raw) return null;
  try {
    return validateUrl(new URL(raw, pageUrl).toString()).toString();
  } catch {
    return null;
  }
}

/** Downloads a picture, or returns null when it can't be fetched, isn't a JPEG/PNG/WebP, or is too big. Never throws. */
export async function safeFetchImage(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; referer?: string } = {},
): Promise<{ mime: string; base64: string } | null> {
  const maxBytes = opts.maxBytes ?? 4_000_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  try {
    let url = validateUrl(raw);
    for (let i = 0; i <= maxRedirects; i++) {
      const res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; RecipePlannerBot/1.0)",
          accept: "image/webp,image/jpeg,image/png",
          ...(opts.referer ? { referer: opts.referer } : {}),
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel();
        if (!loc) return null;
        url = validateUrl(new URL(loc, url).toString());
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return null;
      }
      const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!IMAGE_TYPES.includes(mime)) {
        await res.body?.cancel();
        return null;
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        await res.body?.cancel();
        return null;
      }
      const reader = res.body!.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      if (total < 500) return null;
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.length;
      }
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { mime, base64: btoa(bin) };
    }
  } catch (e) {
    console.error("image fetch failed:", e instanceof Error ? e.message : e);
  }
  return null;
}
