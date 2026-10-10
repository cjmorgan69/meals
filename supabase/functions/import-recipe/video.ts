// Finds a recipe video (YouTube or Vimeo) on a recipe page. We only keep a link; nothing is downloaded.
type Obj = Record<string, unknown>;

const YT_ID = "([A-Za-z0-9_-]{11})";

/** Any YouTube / Vimeo address -> a normal watch link, or null. */
export function normaliseVideoUrl(raw: string): string | null {
  const s = raw.trim().replace(/^\/\//, "https://");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const yt = (id: string | undefined) => (id && new RegExp(`^${YT_ID}$`).test(id) ? `https://www.youtube.com/watch?v=${id}` : null);
  if (host === "youtu.be") return yt(u.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") return yt(u.searchParams.get("v") ?? undefined);
    if (["embed", "shorts", "v", "live"].includes(parts[0])) return parts[1] === "videoseries" ? null : yt(parts[1]);
    return null;
  }
  if (host === "player.vimeo.com") {
    const id = u.pathname.match(/\/video\/(\d+)/)?.[1];
    return id ? `https://vimeo.com/${id}` : null;
  }
  if (host === "vimeo.com") {
    const id = u.pathname.match(/^\/(\d+)/)?.[1];
    return id ? `https://vimeo.com/${id}` : null;
  }
  return null;
}

/** The recipe data's own video field (schema.org VideoObject: embedUrl, contentUrl or url). */
export function videoFromJsonLd(node: Obj): string | null {
  const walk = (v: unknown): string | null => {
    if (typeof v === "string") return normaliseVideoUrl(v);
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = walk(x);
        if (r) return r;
      }
      return null;
    }
    if (v && typeof v === "object") {
      const o = v as Obj;
      for (const k of ["embedUrl", "contentUrl", "url"]) {
        const r = walk(o[k]);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(node.video);
}

/** An embedded player on the page (iframe) or a video share tag. Plain links are ignored: they are usually channels or ads. */
export function videoFromHtml(html: string): string | null {
  for (const m of html.matchAll(/<iframe\b[^>]*?\b(?:src|data-src|data-lazy-src)\s*=\s*["']([^"']+)["']/gi)) {
    const r = normaliseVideoUrl(m[1].replace(/&amp;/g, "&"));
    if (r) return r;
  }
  for (const m of html.slice(0, 200_000).matchAll(/<meta\b[^>]*>/gi)) {
    const key = m[0].match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key !== "og:video" && key !== "og:video:url" && key !== "og:video:secure_url" && key !== "twitter:player") continue;
    const c = m[0].match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    const r = c ? normaliseVideoUrl(c.replace(/&amp;/g, "&")) : null;
    if (r) return r;
  }
  return null;
}
