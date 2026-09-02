import { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Text, TextInput } from "@/frontend/components/scaled-text";
import { router } from "expo-router";
import Constants from "expo-constants";
import { supabase } from "@/frontend/config/supabase";
import { authFetch } from "@/frontend/services/api";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import {
  areNotificationsEnabled,
  setNotificationsEnabled,
  unregisterPushToken,
} from "@/frontend/services/push-notifications";
import { clearOnboardingFlag } from "@/frontend/services/onboarding";
import { useToast } from "@/frontend/components/toast";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SettingsScreen() {
  // Bottom-sheet modal padding — without the inset its Cancel button sits on
  // the home indicator. Applied inline because StyleSheet.create can't read
  // hooks.
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [notifLoading, setNotifLoading] = useState(true);
  const [togglingNotif, setTogglingNotif] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  // Only accounts with an email/password identity can change a password.
  // A Google/Apple SSO-only account has none, so offering the row would lead
  // to a re-auth step they can never satisfy.
  const [hasPasswordLogin, setHasPasswordLogin] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const identities = user?.identities ?? [];
      setHasPasswordLogin(identities.some((i) => i.provider === "email"));
    });
  }, []);

  useEffect(() => {
    areNotificationsEnabled().then((enabled) => {
      setNotificationsOn(enabled);
      setNotifLoading(false);
    });
  }, []);

  const handleToggleNotifications = async (value: boolean) => {
    setNotificationsOn(value);
    setTogglingNotif(true);
    try {
      await setNotificationsEnabled(value);
    } finally {
      setTogglingNotif(false);
    }
  };

  const openPasswordModal = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordModalVisible(true);
  };

  // Not the reset-password.tsx email-code flow — that exists for someone who's
  // signed out and can't remember their password. Here the user has a live
  // session, so the password can be set directly.
  //
  // The current password is re-verified first even though Supabase doesn't
  // require it: without that step, anyone holding an unlocked phone could
  // silently take over the account (change the password, and the real owner is
  // locked out). signInWithPassword against the session's own email is the
  // check — it fails on a wrong password and simply refreshes the existing
  // session on success.
  const handleChangePassword = async () => {
    if (!currentPassword) {
      showToast("Enter your current password to continue.");
      return;
    }
    if (newPassword.length < 6) {
      showToast("Use at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("Those passwords don't match.");
      return;
    }
    if (newPassword === currentPassword) {
      showToast("That's already your current password.");
      return;
    }

    setChangingPassword(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("Couldn't confirm your account. Please sign in again.");

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) throw new Error("That current password isn't right.");

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordModalVisible(false);
      showToast("Password updated.", "success");
    } catch (err: any) {
      showToast(err?.message || "Couldn't update your password. Please try again.");
    } finally {
      setChangingPassword(false);
    }
  };

  // A logged-in user who can't remember their current password can't use the
  // modal above (the re-auth check exists to stop unlocked-phone takeovers,
  // so it can't be waived). Their path is the same email-code recovery the
  // login screen offers — routed there with their own email prefilled so they
  // don't have to log out to reach it.
  const handleForgotCurrentPassword = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      showToast("Couldn't confirm your account. Please sign in again.");
      return;
    }
    setPasswordModalVisible(false);
    router.push({ pathname: "/reset-password", params: { email: user.email } });
  };

  const handleSignOut = () => {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          // Token first, while the session that authorizes the DELETE still
          // exists — after signOut there's no bearer token to send.
          await unregisterPushToken();
          const { error } = await supabase.auth.signOut();
          if (error) {
            // Offline: the local session is still in place and nothing
            // navigated, so say so rather than leaving the tap a no-op.
            showToast("Couldn't sign out — check your connection and try again.");
            return;
          }
          await clearOnboardingFlag();
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your profile, your Spaces, and everything else tied to your account. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Are you absolutely sure?",
              "There's no way to recover your account after this.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete My Account",
                  style: "destructive",
                  onPress: async () => {
                    setDeletingAccount(true);
                    try {
                      const res = await authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/account`, {
                        method: "DELETE",
                      });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body.error || "Please try again.");
                      }
                      await clearOnboardingFlag();
                      await supabase.auth.signOut();
                      router.replace("/auth");
                    } catch (err: any) {
                      showToast(err?.message || "Couldn't delete your account. Please try again.");
                    } finally {
                      setDeletingAccount(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const appVersion = Constants.expoConfig?.version;

  // Feedback goes through the user's own mail app — the backend has no
  // outbound email, and a mail draft the user reviews beats a silent form.
  const handleSendFeedback = async () => {
    const subject = `MovieSpaces feedback (v${appVersion ?? "?"} · ${Platform.OS})`;
    const body = "What happened / what did you expect?\n\n\n---\nApp version: " +
      `${appVersion ?? "unknown"} · ${Platform.OS} ${Platform.Version}`;
    const url = `mailto:moviespaces.dev@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      await Linking.openURL(url);
    } catch {
      showToast("Couldn't open your mail app — email us at moviespaces.dev@gmail.com");
    }
  };

  return (
    <Starfield>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowTextBlock}>
              <Text style={styles.rowTitle}>Push Notifications</Text>
              <Text style={styles.rowSubtitle}>
                New messages, booking updates, and reminders
              </Text>
            </View>
            <Switch
              value={notificationsOn}
              onValueChange={handleToggleNotifications}
              disabled={notifLoading || togglingNotif}
              trackColor={{ false: Palette.borderStrong, true: Palette.accent }}
              thumbColor={Palette.text}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>FEEDBACK</Text>
        <View style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.linkRow}
            onPress={handleSendFeedback}
            accessibilityRole="button"
            accessibilityLabel="Send feedback by email"
          >
            <View style={styles.rowTextBlock}>
              <Text style={styles.linkText}>Send Feedback</Text>
              <Text style={styles.rowSubtitle}>
                Bugs, ideas, anything — opens an email to us
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>LEGAL</Text>
        <View style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.linkRow}
            onPress={() => router.push("/legal/terms")}
          >
            <Text style={styles.linkText}>Terms of Service</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.linkRow}
            onPress={() => router.push("/legal/privacy")}
          >
            <Text style={styles.linkText}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          {hasPasswordLogin && (
            <>
              <TouchableOpacity
                activeOpacity={0.7}
                style={styles.linkRow}
                onPress={openPasswordModal}
              >
                <Text style={styles.linkText}>Change Password</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
            </>
          )}
          <TouchableOpacity activeOpacity={0.7} style={styles.linkRow} onPress={handleSignOut}>
            <Text style={styles.linkText}>Sign Out</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.linkRow}
            onPress={handleDeleteAccount}
            disabled={deletingAccount}
          >
            <Text style={styles.dangerLinkText}>
              {deletingAccount ? "Deleting..." : "Delete Account"}
            </Text>
          </TouchableOpacity>
        </View>

        {appVersion && <Text style={styles.versionText}>Version {appVersion}</Text>}
      </ScrollView>

      <Modal
        visible={passwordModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPasswordModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>Change Password</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Current password"
              placeholderTextColor={Palette.textMuted}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={handleForgotCurrentPassword}
              style={styles.modalForgotLink}
              disabled={changingPassword}
            >
              <Text style={styles.modalForgotText}>Forgot your current password?</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.modalInput}
              placeholder="New password"
              placeholderTextColor={Palette.textMuted}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Confirm new password"
              placeholderTextColor={Palette.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.modalSaveButton}
              onPress={handleChangePassword}
              disabled={changingPassword}
            >
              {changingPassword ? (
                <ActivityIndicator color={Palette.base} />
              ) : (
                <Text style={styles.modalSaveButtonText}>Update Password</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.modalCancelButton}
              onPress={() => setPasswordModalVisible(false)}
              disabled={changingPassword}
            >
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 40 },
  sectionLabel: {
    ...Display.section,
    color: Palette.textFaint,
    marginBottom: 8,
    marginTop: 20,
  },
  card: {
    ...SpaceStyles.glassCard,
    padding: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  rowTextBlock: { flex: 1, marginRight: 12 },
  rowTitle: { ...Type.body, fontWeight: "600", color: Palette.text },
  rowSubtitle: { ...Type.caption, color: Palette.textMuted, marginTop: 2 },
  linkRow: { padding: 14 },
  linkText: { ...Type.body, color: Palette.text },
  dangerLinkText: { ...Type.body, color: Palette.danger, fontWeight: "600" },
  divider: { height: 1, backgroundColor: Palette.border, marginHorizontal: 14 },
  versionText: {
    textAlign: "center",
    ...Type.caption,
    color: Palette.textMuted,
    marginTop: 28,
  },
  modalOverlay: {
    flex: 1,
    // Derived from Palette.base — the old value was the pre-retheme
    // slate-950, which read visibly cool against the warm ground.
    backgroundColor: "rgba(11, 8, 6, 0.85)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: Palette.raised,
    padding: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  modalTitle: { ...Type.title, fontWeight: "700", color: Palette.text, marginBottom: 20 },
  modalInput: {
    ...SpaceStyles.field,
    padding: 12,
    ...Type.body,
    marginBottom: 12,
    color: Palette.text,
  },
  modalSaveButton: {
    backgroundColor: Palette.accent,
    padding: 14,
    borderRadius: Radius.medium,
    alignItems: "center",
    marginTop: 4,
  },
  modalSaveButtonText: { ...Type.body, color: Palette.base, fontWeight: "700" },
  modalCancelButton: { alignItems: "center", padding: 12 },
  modalCancelButtonText: { ...Type.small, color: Palette.textMuted },
  modalForgotLink: { alignSelf: "flex-start", marginTop: -8, marginBottom: 16 },
  modalForgotText: { ...Type.small, color: Palette.accent, fontWeight: "600" },
});
