import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import GuestNudge from './components/GuestNudge';
import UploadStatus from './components/UploadStatus';
import FeedScreen from './screens/FeedScreen';
import PageHost from './screens/Pages';
import AuthSheet from './sheets/AuthSheet';
import CommentsSheet from './sheets/CommentsSheet';
import FindSheet from './sheets/FindSheet';
import MoreSheet from './sheets/MoreSheet';
import NotificationsSheet from './sheets/NotificationsSheet';
import ProfileSheet from './sheets/ProfileSheet';
import SettingsSheet from './sheets/SettingsSheet';
import UploadSheet from './sheets/UploadSheet';
import EarningsSheet from './sheets/EarningsSheet';
import SavedItemsSheet from './sheets/SavedItemsSheet';
import ProductsSheet from './sheets/ProductsSheet';
import * as ExpoLinking from 'expo-linking';
import { parseVideoLink } from './lib/products';
import { startAnalytics } from './lib/analytics';
import { AppProvider, useApp } from './state/AppContext';
import { colors } from './theme';

function SheetHost() {
  const { sheet } = useApp();
  if (!sheet) return null;
  switch (sheet.type) {
    case 'auth': return <AuthSheet reason={sheet.reason} />;
    case 'upload': return <UploadSheet draft={sheet.draft} />;
    case 'profile': return <ProfileSheet />;
    case 'settings': return <SettingsSheet />;
    case 'notifications': return <NotificationsSheet />;
    case 'comments': return <CommentsSheet video={sheet.video} onCountChange={sheet.onCountChange} />;
    case 'more': return <MoreSheet video={sheet.video} onDeleted={sheet.onDeleted} />;
    case 'find': return <FindSheet initialQuery={sheet.initialQuery} videoId={sheet.videoId} />;
    case 'products': return <ProductsSheet video={sheet.video} />;
    case 'earnings': return <EarningsSheet />;
    case 'saved': return <SavedItemsSheet />;
  }
}

/** Opens a video when the app is launched or resumed from piitrade://v/<id> or a link to this site's /v/<id>. */
function useVideoDeepLinks() {
  const { ready, pushPage } = useApp();
  React.useEffect(() => {
    if (!ready) return;
    const open = (url: string | null) => {
      const id = parseVideoLink(url);
      if (id) pushPage({ name: 'video', id });
    };
    ExpoLinking.getInitialURL().then(open).catch(() => {});
    const sub = ExpoLinking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}

function Shell() {
  const { ready } = useApp();
  useVideoDeepLinks();
  React.useEffect(() => startAnalytics(), []);
  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return (
    <View style={styles.root}>
      {/* Signed-out viewers land straight on the feed — no login wall. */}
      <FeedScreen />
      <PageHost />
      <GuestNudge />
      <UploadStatus />
      <SheetHost />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  boot: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
