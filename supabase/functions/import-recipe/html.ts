// Small HTML helpers. No DOM available in the edge runtime, so these use regular expressions.

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—", "&deg;": "°",
  "&frac12;": "½", "&frac14;": "¼", "&frac34;": "¾", "&rsquo;": "’", "&lsquo;": "‘",
  "&ldquo;": "“", "&rdquo;": "”", "&hellip;": "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|[a-z][a-z0-9]*);/gi, (m, dec?: string, hex?: string) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : NaN;
    if (!Number.isNaN(code)) return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    return ENTITIES[m.toLowerCase()] ?? m;
  });
}

/** HTML fragment to plain text, keeping line breaks for <br>, <p> and <li>. */
export function fragmentToText(s: string): string {
  const withBreaks = s.replace(/<\/(p|li|div|h[1-6])>|<br\s*\/?>/gi, "\n");
  const text = decodeEntities(withBreaks.replace(/<[^>]*>/g, " "));
  return text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

/** Whole page to readable text for the AI fallback. */
export function htmlToText(html: string, maxChars = 24000): string {
  const t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const text = fragmentToText(t);
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** All JSON-LD blocks in a page, parsed. Unparseable blocks are skipped. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const txt = m[1].trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
    try {
      out.push(JSON.parse(txt));
    } catch {
      try {
        out.push(JSON.parse(txt.replace(/[\u0000-\u001f]+/g, " ")));
      } catch { /* ignore bad block */ }
    }
  }
  return out;
}
