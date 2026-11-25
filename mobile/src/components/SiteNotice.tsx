import React, { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { compareVersions } from '../lib/guestPrompt';
import { refreshSiteConfig, useSiteConfig } from '../state/siteConfig';
import { colors, radius, space } from '../theme';
import { Icon, IconButton } from './ui';

const DISMISSED_KEY = 'piitrade_dismissed_notices';
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

const open = (url: string) => Linking.openURL(url).catch(() => {});

/**
 * Everything the admin controls from "Site & app settings" that people must see:
 *  - an update-required screen when this build is older than the minimum version,
 *  - a maintenance strip (watching still works, writes are paused),
 *  - the announcement banner and an "update available" hint, each dismissible and shown again only when changed.
 * It also re-reads the settings whenever the app comes back to the foreground.
 */
export default function SiteNotice() {
  const cfg = useSiteConfig();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    refreshSiteConfig();
    AsyncStorage.getItem(DISMISSED_KEY).then((v) => v && setDismissed(JSON.parse(v))).catch(() => {});
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshSiteConfig());
    return () => sub.remove();
  }, []);

  const dismiss = (id: string) => {
    const next = [...dismissed.filter((d) => !d.startsWith(id.split(':')[0] + ':')), id];
    setDismissed(next);
    AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next)).catch(() => {});
  };

  const { app, announcement, maintenance } = cfg;
  const mustUpdate = !!app.minVersion && compareVersions(APP_VERSION, app.minVersion) < 0;
  const annId = `announcement:${announcement.version}`;
  const updId = `update:${app.latestVersion}`;
  const showAnn = announcement.enabled && !!announcement.text && !dismissed.includes(annId);
  const showUpd = !mustUpdate && !!app.latestVersion && compareVersions(APP_VERSION, app.latestVersion) < 0 && !dismissed.includes(updId);

  return (
    <>
      <Modal visible={mustUpdate} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={styles.block}>
          <Icon name="cloud-download-outline" size={52} color={colors.brandSoft} />
          <Text style={styles.blockTitle}>Update required</Text>
          <Text style={styles.blockText}>{app.updateMessage || 'A new version of Piitrade Videos is required to continue.'}</Text>
          <Text style={styles.blockSmall}>You have {APP_VERSION} · required {app.minVersion}</Text>
          {!!app.updateUrl && (
            <Pressable onPress={() => open(app.updateUrl)} style={styles.blockBtn} accessibilityRole="button">
              <Text style={styles.blockBtnText}>Update now</Text>
            </Pressable>
          )}
        </View>
      </Modal>

      <View pointerEvents="box-none" style={[styles.stack, { top: insets.top + space.sm }]}>
        {maintenance.enabled && (
          <View style={[styles.card, { borderColor: 'rgba(255,179,71,0.5)' }]} accessibilityRole="alert">
            <Icon name="construct-outline" size={18} color={colors.brandSoft} />
            <Text style={styles.text}>{maintenance.message || 'Maintenance in progress — uploads, likes and comments are paused.'}</Text>
          </View>
        )}
        {showAnn && (
          <View style={[styles.card, announcement.level === 'warning' && { borderColor: 'rgba(255,179,71,0.5)' }, announcement.level === 'success' && { borderColor: 'rgba(61,220,151,0.5)' }]}>
            <Icon name={announcement.level === 'warning' ? 'warning-outline' : announcement.level === 'success' ? 'checkmark-circle-outline' : 'information-circle-outline'} size={18} color={colors.brandSoft} />
            <Text style={styles.text}>
              {announcement.text}
              {!!announcement.link && (
                <Text style={styles.link} onPress={() => open(announcement.link)}>{'  '}Learn more</Text>
              )}
            </Text>
            <IconButton name="close" label="Dismiss announcement" size={16} color={colors.textMuted} onPress={() => dismiss(annId)} style={styles.close} />
          </View>
        )}
        {showUpd && (
          <View style={styles.card}>
            <Icon name="arrow-up-circle-outline" size={18} color={colors.brandSoft} />
            <Text style={styles.text}>
              Version {app.latestVersion} is available.
              {!!app.updateUrl && <Text style={styles.link} onPress={() => open(app.updateUrl)}>{'  '}Update</Text>}
            </Text>
            <IconButton name="close" label="Dismiss update notice" size={16} color={colors.textMuted} onPress={() => dismiss(updId)} style={styles.close} />
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  stack: { position: 'absolute', left: space.md, right: space.md, zIndex: 60, gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(28,28,30,0.96)',
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  text: { flex: 1, color: colors.text, fontSize: 12.5, lineHeight: 17 },
  link: { color: colors.brandSoft, fontWeight: '800' },
  close: { width: 28, height: 28 },
  block: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  blockTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  blockText: { color: colors.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  blockSmall: { color: colors.textFaint, fontSize: 12 },
  blockBtn: { marginTop: space.lg, backgroundColor: colors.brand, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill },
  blockBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
