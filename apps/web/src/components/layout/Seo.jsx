import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { selectContent } from '../../features/content/contentSlice.js';

/**
 * Sets the document title and meta description per route.
 *
 * Written by hand rather than pulling in react-helmet: this is a client-rendered
 * SPA, so a helmet library would buy nothing a useEffect does not. When SEO
 * genuinely matters, the answer is prerendering, not a bigger meta library —
 * see docs/DEPLOYMENT.md.
 */
const SITE_URL = 'https://asphalix.com';

export default function Seo({ title, description, canonical, noindex }) {
  const content = useSelector(selectContent);
  const seo = content?.seo;

  useEffect(() => {
    const template = seo?.titleTemplate ?? '%s · Asphalix';
    document.title = title ? template.replace('%s', title) : (seo?.defaultTitle ?? 'Asphalix');

    setMeta('name', 'description', description ?? seo?.defaultDescription ?? '');
    setMeta('property', 'og:title', document.title);
    setMeta('property', 'og:description', description ?? seo?.defaultDescription ?? '');
    if (seo?.ogImage) setMeta('property', 'og:image', new URL(seo.ogImage, SITE_URL).href);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');

    const href = canonical ?? `${SITE_URL}${window.location.pathname}`;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = href;
  }, [title, description, canonical, noindex, seo]);

  return null;
}

function setMeta(attr, key, value) {
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}
