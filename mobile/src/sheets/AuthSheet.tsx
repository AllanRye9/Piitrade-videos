import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import Sheet from '../components/Sheet';
import { Button, ErrorText, Icon, TextField } from '../components/ui';
import { WEB_URL } from '../config';
import { useApp } from '../state/AppContext';
import { colors, space } from '../theme';

type Mode = 'login' | 'signup' | 'forgot' | 'forgot-sent';

/** Sign-in / sign-up / forgot-password popup. Always cancellable — guests can keep watching. */
export default function AuthSheet({ reason }: { reason?: string }) {
  const { closeSheet, completeAuth } = useApp();
  const [mode, setMode] = useState<Mode>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setError(null);
    setMode(next);
  }

  async function submit() {
    setError(null);
    if (mode === 'signup' && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') completeAuth(await api.login(identifier.trim(), password));
      else if (mode === 'signup') completeAuth(await api.signup(identifier.trim(), password));
      else {
        await api.forgotPassword(identifier.trim());
        setMode('forgot-sent');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'login' ? 'Log in to Piitrade' : 'Reset your password';

  return (
    <Sheet title={title} onClose={closeSheet} maxHeight={0.92}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {reason && mode !== 'forgot-sent' ? (
          <View style={styles.reason}>
            <Icon name="sparkles" size={18} color={colors.brandSoft} />
            <Text style={styles.reasonText}>{reason}</Text>
          </View>
        ) : null}

        {mode === 'forgot-sent' ? (
          <>
            <Text style={styles.copy}>If an account exists for that email or username, a reset link is on its way. Open it on this phone to choose a new password.</Text>
            <Button title="Back to log in" onPress={() => switchMode('login')} />
          </>
        ) : (
          <>
            <TextField
              label={mode === 'signup' ? 'Email' : 'Email or username'}
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={mode === 'signup' ? 'you@example.com' : 'Email or username'}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={mode === 'signup' ? 'email-address' : 'default'}
              textContentType={mode === 'signup' ? 'emailAddress' : 'username'}
              autoComplete={mode === 'signup' ? 'email' : 'username'}
            />
            {mode !== 'forgot' && (
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Password'}
                secureTextEntry
                autoCapitalize="none"
                textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            )}
            {mode === 'signup' && (
              <TextField label="Confirm password" value={confirm} onChangeText={setConfirm} placeholder="Repeat password" secureTextEntry autoCapitalize="none" textContentType="newPassword" />
            )}

            <ErrorText>{error}</ErrorText>

            {mode === 'login' && (
              <Pressable onPress={() => switchMode('forgot')} hitSlop={8}>
                <Text style={styles.link}>Forgot password?</Text>
              </Pressable>
            )}

            <Button
              title={mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
              icon={mode === 'login' ? 'log-in-outline' : mode === 'signup' ? 'person-add-outline' : 'mail-outline'}
              onPress={submit}
              busy={busy}
              disabled={!identifier.trim() || (mode !== 'forgot' && password.length === 0)}
            />

            {mode === 'signup' && (
              <Text style={styles.fine}>
                By creating an account you agree to our{' '}
                <Text style={styles.fineLink} onPress={() => Linking.openURL(`${WEB_URL}/legal/terms`)}>
                  Terms
                </Text>{' '}
                and{' '}
                <Text style={styles.fineLink} onPress={() => Linking.openURL(`${WEB_URL}/legal/privacy`)}>
                  Privacy Policy
                </Text>
                .
              </Text>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.copy}>{mode === 'login' ? 'New here?' : mode === 'signup' ? 'Already have an account?' : 'Remembered it?'}</Text>
              <Pressable onPress={() => switchMode(mode === 'login' ? 'signup' : 'login')} hitSlop={8}>
                <Text style={styles.link}>{mode === 'login' ? 'Create an account' : 'Log in'}</Text>
              </Pressable>
            </View>
          </>
        )}

        <Pressable onPress={closeSheet} hitSlop={8} style={styles.later}>
          <Text style={styles.laterText}>Not now — keep watching</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg },
  reason: { flexDirection: 'row', gap: space.sm, alignItems: 'center', backgroundColor: 'rgba(255,179,71,0.12)', padding: space.md, borderRadius: 14 },
  reasonText: { color: colors.brandSoft, fontSize: 13, flex: 1, fontWeight: '600' },
  copy: { color: colors.textMuted, fontSize: 14 },
  link: { color: colors.brandSoft, fontSize: 14, fontWeight: '700' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  fine: { color: colors.textFaint, fontSize: 11, textAlign: 'center' },
  fineLink: { textDecorationLine: 'underline' },
  later: { alignItems: 'center', paddingVertical: space.sm },
  laterText: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
});
