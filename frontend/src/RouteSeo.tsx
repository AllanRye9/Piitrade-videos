import { useLocation } from 'react-router-dom';
import { useSeo, SeoMeta } from './seo';

const LEGAL_TITLES: Record<string, string> = { terms: 'Terms of Service', privacy: 'Privacy Policy', dmca: 'Copyright & DMCA' };

/**
 * Route-level SEO defaults, so every screen has correct tags even if its own
 * component doesn't set any. Pages with richer data (the shared-video page,
 * hashtag and creator pages) call useSeo themselves. This component is mounted
 * before <Routes>, so its effect runs first and the page's own effect then
 * overrides it.
 *
 * Private / gated / non-content screens are noindex.
 */
export default function RouteSeo() {
  const { pathname } = useLocation();
  let meta: SeoMeta;

  if (pathname.startsWith('/const/admin') || pathname.startsWith('/admin')) {
    meta = { title: 'Admin', noindex: true };
  } else if (pathname === '/reset-password') {
    meta = { title: 'Reset password', noindex: true };
  } else if (pathname.startsWith('/legal/')) {
    const title = LEGAL_TITLES[pathname.split('/')[2]];
    meta = { title: title || 'Legal', canonical: pathname };
  } else if (pathname === '/') {
    meta = { canonical: '/' };
  } else if (pathname.startsWith('/v/')) {
    // The page sets its own (needs the video); until it loads, don't index the placeholder.
    meta = { title: 'Video', noindex: true };
  } else {
    // /profile, /discover, /u/:handle, /tag/:tag … sit behind the sign-in gate.
    meta = { noindex: true };
  }
  useSeo(meta);
  return null;
}
