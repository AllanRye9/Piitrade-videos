import { useEffect } from 'react';

/**
 * Client-side SEO: keeps <title>, description, canonical, robots, Open Graph /
 * Twitter tags and JSON-LD in sync with the current route. Googlebot runs the
 * app's JavaScript, so this is what it indexes for in-app navigation. Bots that
 * don't run JS (WhatsApp, Facebook, X…) get the same tags from the backend for
 * the public pages — see backend/src/routes/seo.ts. Every tag we manage carries
 * `data-seo` so the server-injected ones are replaced rather than duplicated.
 */

export const SITE_NAME = 'Piitrade Videos';
export const DEFAULT_DESCRIPTION = 'Creative short videos that link to the products you see. Watch, then find the item on the shop.';

export interface SeoMeta {
  /** Page title; the site name is appended. Omit for the home page. */
  title?: string;
  description?: string;
  /** Path (e.g. "/v/abc") or absolute URL. Defaults to the current path, without query/hash. */
  canonical?: string;
  /** "noindex" pages that are gated, private or thin. */
  noindex?: boolean;
  image?: string | null;
  ogType?: string;
  jsonLd?: unknown;
}

type Attr = 'name' | 'property';

function setMeta(attr: Attr, key: string, content: string | null) {
  const sel = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(sel);
  if (content === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  el.setAttribute('data-seo', '');
}

function setLink(rel: string, href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (href === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  el.setAttribute('data-seo', '');
}

function abs(urlOrPath: string): string {
  try {
    return new URL(urlOrPath, window.location.origin).toString();
  } catch {
    return urlOrPath;
  }
}

export function applySeo(meta: SeoMeta): void {
  if (typeof document === 'undefined') return;
  const title = meta.title ? `${meta.title} · ${SITE_NAME}` : `${SITE_NAME} — creative videos that link to products`;
  const description = (meta.description || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim().slice(0, 200);
  const canonical = abs(meta.canonical ?? window.location.pathname);
  const image = abs(meta.image || '/og-default.png');

  document.title = title;
  setMeta('name', 'description', description);
  setMeta('name', 'robots', meta.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large');
  setLink('canonical', meta.noindex ? null : canonical);
  setMeta('property', 'og:site_name', SITE_NAME);
  setMeta('property', 'og:type', meta.ogType || 'website');
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', description);
  setMeta('property', 'og:url', canonical);
  setMeta('property', 'og:image', image);
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', description);
  setMeta('name', 'twitter:image', image);

  document.head.querySelectorAll('script[type="application/ld+json"][data-seo]').forEach((n) => n.remove());
  if (meta.jsonLd) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.setAttribute('data-seo', '');
    s.text = JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c');
    document.head.appendChild(s);
  }
}

/** Declares the SEO metadata for the page that is mounted. Re-applies when any field changes. */
export function useSeo(meta: SeoMeta): void {
  const key = JSON.stringify(meta);
  useEffect(() => {
    applySeo(meta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
