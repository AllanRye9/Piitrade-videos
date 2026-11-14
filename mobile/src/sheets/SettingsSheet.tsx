import React, { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { api } from '../api';
import Sheet from '../components/Sheet';
import { Avatar, Button, ErrorText, Icon, SectionLabel, TextField } from '../components/ui';
import { WEB_URL, piitradeUrl } from '../config';
import { pickAvatar } from '../lib/pickers';
import { useApp, useProfile } from '../state/AppContext';
import { mutedStore, profileStore, setMuted } from '../state/stores';
import { colors, radius, space } from '../theme';

/** Account, profile editing, sound and legal — all in one popup. */
export default function SettingsSheet() {
  const { closeSheet, email, signOut } = useApp();
  const profile = useProfile();
  const muted = useSyncExternalStore(mutedStore.subscribe, () => mutedStore.get().muted);

  const [name, setName] = useState(profile.displayName || '');
  const [handle, setHandle] = useState(profile.handle || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.updateProfile({ displayName: name.trim() || null, bio: bio.trim() || null });
      profileStore.set({ displayName: res.displayName, bio: res.bio });
      const wanted = handle.trim().toLowerCase();
      if (wanted && wanted !== profile.handle) {
        const h = await api.updateHandle(wanted);
        profileStore.set({ handle: h.handle });
        setHandle(h.handle);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function changeAvatar() {
    setError(null);
    try {
      const file = await pickAvatar();
      if (!file) return;
      setAvatarBusy(true);
      const res = await api.uploadAvatar(file);
      profileStore.set({ avatar: res.avatar });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update photo');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      await api.deleteAvatar();
      profileStore.set({ avatar: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove photo');
    } finally {
      setAvatarBusy(false);
    }
  }

  async function sendReset() {
    if (!email) return;
    try {
      await api.forgotPassword(email);
      setResetSent(true);
    } catch {
      // leave the button available for another try
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Your account and videos stay safe — log back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  return (
    <Sheet title="Settings" onClose={closeSheet} maxHeight={0.92}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.photoRow}>
          <Pressable onPress={changeAvatar} accessibilityRole="button" accessibilityLabel="Change profile photo">
            <Avatar uri={profile.avatar} name={profile.displayName || profile.handle} size={72} />
            <View style={styles.cam}>{avatarBusy ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="camera" size={14} color="#fff" />}</View>
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.photoTitle}>Profile photo</Text>
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Pressable onPress={changeAvatar}>
                <Text style={styles.link}>Change</Text>
              </Pressable>
              {profile.avatar ? (
                <Pressable onPress={removeAvatar}>
                  <Text style={[styles.link, { color: colors.danger }]}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.group}>
          <SectionLabel>Profile</SectionLabel>
          <TextField label="Display name" value={name} onChangeText={setName} maxLength={40} placeholder="Your name" />
          <TextField label="Username" value={handle} onChangeText={(t) => setHandle(t.toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={30} placeholder="username" />
          <TextField label="Bio" value={bio} onChangeText={setBio} multiline maxLength={160} placeholder="Tell people about you" />
          <ErrorText>{error}</ErrorText>
          <Button title={saved ? 'Saved' : 'Save changes'} icon={saved ? 'checkmark' : undefined} onPress={save} busy={saving} />
        </View>

        <View style={styles.group}>
          <SectionLabel>Playback</SectionLabel>
          <View style={styles.row}>
            <Icon name={muted ? 'volume-mute' : 'volume-high'} />
            <Text style={styles.rowText}>Mute videos</Text>
            <Switch value={muted} onValueChange={setMuted} trackColor={{ true: colors.brand, false: colors.surfaceHigh }} />
          </View>
        </View>

        <View style={styles.group}>
          <SectionLabel>Account</SectionLabel>
          <View style={styles.row}>
            <Icon name="mail-outline" />
            <Text style={[styles.rowText, { flex: 1 }]} numberOfLines={1}>
              {email}
            </Text>
          </View>
          <Pressable style={styles.row} onPress={sendReset} disabled={resetSent}>
            <Icon name="key-outline" />
            <Text style={styles.rowText}>{resetSent ? 'Reset link sent — check your email' : 'Change password'}</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={confirmSignOut}>
            <Icon name="log-out-outline" color={colors.danger} />
            <Text style={[styles.rowText, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        </View>

        <View style={styles.group}>
          <SectionLabel>About</SectionLabel>
          <Pressable style={styles.row} onPress={() => Linking.openURL(piitradeUrl('/'))}>
            <Icon name="storefront-outline" />
            <Text style={styles.rowText}>Open Piitrade marketplace</Text>
          </Pressable>
          {[['Terms of Service', '/legal/terms'], ['Privacy Policy', '/legal/privacy'], ['Copyright (DMCA)', '/legal/dmca']].map(([label, path]) => (
            <Pressable key={path} style={styles.row} onPress={() => Linking.openURL(`${WEB_URL}${path}`)}>
              <Icon name="document-text-outline" />
              <Text style={styles.rowText}>{label}</Text>
            </Pressable>
          ))}
          <Text style={styles.version}>Piitrade Videos {Constants.expoConfig?.version ?? ''}</Text>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.sm, gap: space.xl },
  group: { gap: space.md },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  photoTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  cam: { position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  link: { color: colors.brandSoft, fontWeight: '700', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: 52 },
  rowText: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  version: { color: colors.textFaint, fontSize: 12, textAlign: 'center', marginTop: space.sm },
});
