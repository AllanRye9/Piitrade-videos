import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import GuestNudge from './components/GuestNudge';
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
import { AppProvider, useApp } from './state/AppContext';
import { colors } from './theme';

function SheetHost() {
  const { sheet } = useApp();
  if (!sheet) return null;
  switch (sheet.type) {
    case 'auth': return <AuthSheet reason={sheet.reason} />;
    case 'upload': return <UploadSheet />;
    case 'profile': return <ProfileSheet />;
    case 'settings': return <SettingsSheet />;
    case 'notifications': return <NotificationsSheet />;
    case 'comments': return <CommentsSheet video={sheet.video} onCountChange={sheet.onCountChange} />;
    case 'more': return <MoreSheet video={sheet.video} />;
    case 'find': return <FindSheet initialQuery={sheet.initialQuery} />;
  }
}

function Shell() {
  const { ready } = useApp();
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
