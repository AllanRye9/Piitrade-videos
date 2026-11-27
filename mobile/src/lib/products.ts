import { Alert } from 'react-native';
import { api } from '../api';
import { API_BASE, WEB_URL } from '../config';
import { isNetworkError } from './net';
import { OFFLINE_BODY, OFFLINE_TITLE, openWebLink } from './links';
import { embedSnippet as embedSnippetFor, parseVideoLink as parseVideoLinkFor } from './productLogic';

export { activeProducts, clock, frameFit, frameRect } from './productLogic';
export type { Frame } from './productLogic';

export const parseVideoLink = (url: string | null | undefined) => parseVideoLinkFor(url, WEB_URL);
export const embedSnippet = (videoId: string) => embedSnippetFor(videoId, WEB_URL);

/**
 * Opens a product in the system browser (not a WebView, so the shop's own sign-in/checkout work),
 * through the attribution endpoint so the tap is logged. If that call fails — offline, server hiccup —
 * the viewer still gets to the product: pinned products via the public /go redirect, plain links directly.
 */
export async function openProduct(videoId: string, target: { productId?: string; url?: string }): Promise<void> {
  let dest: string | null = null;
  try {
    dest = (await api.clickThrough(videoId, target)).url;
  } catch (err) {
    // No connection: say so here. Falling back to the browser would just open an error page showing
    // the website address and pull the viewer out of the video for nothing.
    if (isNetworkError(err)) {
      Alert.alert(OFFLINE_TITLE, OFFLINE_BODY);
      return;
    }
    // The server answered with an error: the viewer can still reach the product.
    dest = target.productId ? `${API_BASE || WEB_URL}/go/${encodeURIComponent(videoId)}/${encodeURIComponent(target.productId)}` : target.url ?? null;
  }
  if (dest) await openWebLink(dest);
}
