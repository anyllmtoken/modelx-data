/**
 * Shared parsing utilities for fetch scripts.
 * Identical to modelpedia packages/data/scripts/parse.ts
 */

// ── HTTP ──

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.text();
}

export async function fetchJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

// ── HTML ──

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseHtmlTable(tableHtml: string): string[][] {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  return rows.map(row =>
    [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => stripHtml(c[1]))
  );
}

export function parseAllHtmlTables(html: string): string[][][] {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map(t => parseHtmlTable(t[1]));
}

export function findHtmlTables(html: string): { raw: string; rows: string[][] }[] {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map(m => ({
    raw: m[0], rows: parseHtmlTable(m[1]),
  }));
}

// ── Price extraction ──

export function extractPrice(text: string): number | undefined {
  const m = text.match(/\$([\d,.]+)/);
  if (!m) return undefined;
  return Number(m[1].replace(/,/g, ""));
}

export function extractAllPrices(text: string): number[] {
  return [...text.matchAll(/\$([\d,.]+)/g)].map(m => Number(m[1].replace(/,/g, "")));
}

export const parsePrice = extractPrice;

// ── Token counts ──

export function parseTokenCount(text: string): number | undefined {
  const cleaned = text.replace(/,/g, "").trim();
  const m = cleaned.match(/([\d.]+)\s*([KkMm])?/);
  if (!m) return undefined;
  const num = Number(m[1]);
  if (m[2] === "K" || m[2] === "k") return num * 1000;
  if (m[2] === "M" || m[2] === "m") return num * 1_000_000;
  return num;
}

// ── Date extraction ──

export function extractDate(text: string): string | undefined {
  const iso = text.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const monthYear = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}/i);
  if (monthYear) return monthYear[0];
  return undefined;
}

// ── HTML page helpers ──

export function findPrecedingHeading(html: string, position: number, maxLookback = 500): string | undefined {
  const before = html.slice(Math.max(0, position - maxLookback), position);
  const headings = [...before.matchAll(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/g)];
  if (headings.length === 0) return undefined;
  return stripHtml(headings[headings.length - 1][1]);
}

export function extractHeadings(html: string): { id: string; text: string; index: number }[] {
  return [...html.matchAll(/<h[2-6][^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h[2-6]>/g)]
    .map(m => ({ id: m[1], text: stripHtml(m[2]), index: m.index! }));
}

export function splitByHeadings(html: string, filter?: (id: string) => boolean): Map<string, string> {
  const headings = extractHeadings(html);
  const filtered = filter ? headings.filter(h => filter(h.id)) : headings;
  const map = new Map<string, string>();
  for (let i = 0; i < filtered.length; i++) {
    const start = filtered[i].index;
    const end = i + 1 < filtered.length ? filtered[i + 1].index : html.length;
    map.set(filtered[i].id, html.slice(start, end));
  }
  return map;
}
