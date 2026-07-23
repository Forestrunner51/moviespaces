import { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "@/frontend/config/supabase";
import { Starfield } from "@/frontend/components/starfield";
import { ShootingStars } from "@/frontend/components/shooting-stars";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

// Uses Supabase's OTP recovery-code flow rather than the emailed-link flow:
// the link flow needs deep-link redirect config + fragment parsing (fragile
// on React Native), whereas the code flow is fully in-app. Requires the
// Supabase "Reset Password" email template to surface the code via
// {{ .Token }} (see the note at the bottom of this file / the setup docs).
export default function ResetPasswordScreen() {
  const router = useRouter();
  // "request" = ask for the email; "verify" = enter code + new password.
  const [stage, setStage] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendCode = async () => {
    if (!email.trim()) {
      Alert.alert("Email required", "Enter the email tied to your account.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setLoading(false);
    if (error) {
      Alert.alert("Couldn't send code", error.message);
      return;
    }
    // Move on regardless of whether the address exists — revealing which
    // emails have accounts would be an enumeration leak.
    setStage("verify");
  };

  const handleResetPassword = async () => {
    if (!code.trim() || !newPassword) {
      Alert.alert("Missing info", "Enter the code from your email and a new password.");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("Password too short", "Use at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      // Verifying the recovery code signs the user in with a temporary
      // session, which is what lets updateUser change the password.
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "recovery",
      });
      if (verifyError) throw verifyError;

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;

      Alert.alert("Password updated", "You're all set — you're now signed in.", [
        { text: "OK", onPress: () => router.replace("/") },
      ]);
    } catch (err: any) {
      Alert.alert("Couldn't reset password", err.message || "Check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Starfield>
      <ShootingStars />
      <View style={styles.container}>
        <Text style={[styles.header, SpaceStyles.glowText]}>Reset Password</Text>

        {stage === "request" ? (
          <>
            <Text style={styles.subHeader}>
              Enter your email and we&apos;ll send you a reset code.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.button}
              onPress={handleSendCode}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={SpaceTheme.backgroundVoid} />
              ) : (
                <Text style={styles.buttonText}>Send Reset Code</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.subHeader}>
              We sent a code to {email.trim()}. Enter it below with your new password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Reset code"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              keyboardType="number-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={SpaceTheme.mutedOrbit}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.button}
              onPress={handleResetPassword}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={SpaceTheme.backgroundVoid} />
              ) : (
                <Text style={styles.buttonText}>Update Password</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleSendCode()}
              style={styles.switchLink}
              disabled={loading}
            >
              <Text style={styles.switchText}>Didn&apos;t get it? Resend code</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => router.back()} style={styles.switchLink}>
          <Text style={styles.switchText}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  header: {
    fontSize: 32,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
    textAlign: "center",
    marginBottom: 8,
  },
  subHeader: {
    fontSize: 15,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginBottom: 28,
    lineHeight: 21,
  },
  input: {
    ...SpaceStyles.glassCard,
    color: SpaceTheme.starWhite,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: SpaceTheme.glowCyan,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: SpaceTheme.backgroundVoid, fontSize: 18, fontWeight: "bold" },
  switchLink: { marginTop: 20, alignItems: "center" },
  switchText: { color: SpaceTheme.mutedOrbit, fontSize: 14 },
});
