import { Alert, Linking } from 'react-native';
import { networkStore } from '../state/network';

export const OFFLINE_TITLE = 'You’re offline';
export const OFFLINE_BODY = 'Connect to the internet and try again.';

/**
 * Opens a web page — unless we already know we're offline. Handing an unreachable address to the
 * system browser throws the user out of the app onto the browser's "site can't be reached" page,
 * which shows the raw website URL. Better to say so inside the app and keep them where they are.
 */
export async function openWebLink(url: string): Promise<void> {
  if (networkStore.isOffline()) {
    Alert.alert(OFFLINE_TITLE, OFFLINE_BODY);
    return;
  }
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Couldn’t open the link', 'Please try again in a moment.');
  }
}
