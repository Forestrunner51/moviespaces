import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert, ScrollView } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { supabase } from "@/frontend/config/supabase";
import { authFetch } from "@/frontend/services/api";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { areNotificationsEnabled, setNotificationsEnabled } from "@/frontend/services/push-notifications";

export default function SettingsScreen() {
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [notifLoading, setNotifLoading] = useState(true);
  const [togglingNotif, setTogglingNotif] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

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

  const handleSignOut = () => {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
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
                      await supabase.auth.signOut();
                      router.replace("/auth");
                    } catch (err: any) {
                      Alert.alert("Couldn't delete account", err.message || "Please try again.");
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
              trackColor={{ false: "rgba(255,255,255,0.15)", true: SpaceTheme.glowCyan }}
              thumbColor={SpaceTheme.starWhite}
            />
          </View>
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
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
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
  rowTitle: { fontSize: 16, fontWeight: "600", color: SpaceTheme.starWhite },
  rowSubtitle: { fontSize: 12, color: SpaceTheme.mutedOrbit, marginTop: 2 },
  linkRow: { padding: 14 },
  linkText: { fontSize: 16, color: SpaceTheme.starWhite },
  dangerLinkText: { fontSize: 16, color: SpaceTheme.danger, fontWeight: "600" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginHorizontal: 14 },
  versionText: {
    textAlign: "center",
    fontSize: 12,
    color: SpaceTheme.mutedOrbit,
    marginTop: 28,
  },
});
