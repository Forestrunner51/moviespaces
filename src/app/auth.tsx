import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "../frontend/config/supabase";
import { useRouter } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { consumePendingRedirect } from "@/frontend/services/pending-redirect";
import { signInWithGoogle, signInWithApple, isAppleSignInAvailable } from "@/frontend/services/sso";

// Routes to the one-time genre-picker onboarding screen instead of straight
// into the app, unless this device has already been through it — checked via
// AsyncStorage rather than a server-side "is this a new user" flag, since
// there's no Users table this app owns to put that on (auth is Supabase's).
// onboarding-interests.tsx itself consumes the pending redirect once it's
// done, so a deep-link invite that triggered a fresh sign-up is still
// honored, just after this one extra step instead of before it.
async function afterAuthSuccess(router: ReturnType<typeof useRouter>) {
  const hasOnboarded = await AsyncStorage.getItem("hasOnboardedInterests");
  if (hasOnboarded) {
    router.replace(consumePendingRedirect() ?? "/");
  } else {
    router.replace("/onboarding-interests");
  }
}

export default function AuthScreen() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<"google" | "apple" | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  // SSO never collects a display name up front (unlike email/password
  // sign-up), so pull whatever the provider handed back — Supabase's
  // handle_new_user() trigger already writes it into profiles.display_name
  // on first login, same as it does for the full_name passed at signUp().
  const finishSsoLogin = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name;
    if (fullName) {
      await AsyncStorage.setItem("userName", fullName);
    }
    await afterAuthSuccess(router);
  };

  const handleGoogleSignIn = async () => {
    if (ssoLoading || loading) return;
    setSsoLoading("google");
    const result = await signInWithGoogle();
    setSsoLoading(null);
    if (result.success) {
      await finishSsoLogin();
    } else if (!result.cancelled) {
      Alert.alert("Couldn't sign in with Google", result.error || "Please try again.");
    }
  };

  const handleAppleSignIn = async () => {
    // Guards double-taps — the native AppleAuthenticationButton has no
    // built-in disabled/loading prop, unlike the custom Google button below.
    if (ssoLoading || loading) return;
    setSsoLoading("apple");
    const result = await signInWithApple();
    setSsoLoading(null);
    if (result.success) {
      await finishSsoLogin();
    } else if (!result.cancelled) {
      Alert.alert("Couldn't sign in with Apple", result.error || "Please try again.");
    }
  };

  async function handleAuth() {
    if (!email || !password || (isSignUp && !name)) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }
    setLoading(true);

    if (isSignUp) {
      // Handle Registration — pass name as user_metadata so it's attached
      // to the account itself, not just this device.
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: name.trim() },
        },
      });

      if (error) {
        Alert.alert("Sign Up Error", error.message);
      } else if (data.session) {
        // Email confirmation is OFF in Supabase — signUp returned a live
        // session, so drop them straight into the app.
        await AsyncStorage.setItem("userName", name.trim());
        await afterAuthSuccess(router);
      } else {
        // Email confirmation is ON — no session yet; the account isn't usable
        // until they click the link we just emailed. Without handling this,
        // the app silently bounced back to the login screen (the root layout
        // redirects whenever there's no session), looking broken. Tell them
        // what to do and flip to the sign-in view for when they come back.
        await AsyncStorage.setItem("userName", name.trim());
        Alert.alert(
          "Check your email",
          `We sent a confirmation link to ${email.trim()}. Tap it to activate your account, then sign in.`,
        );
        setIsSignUp(false);
      }
    } else {
      // Handle Login
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) {
        Alert.alert("Login Error", error.message);
      } else {
        // Pull the name back out of user_metadata and cache it locally too,
        // so returning users on a new device also get their name pre-filled.
        const fullName = data.user?.user_metadata?.full_name;
        if (fullName) {
          await AsyncStorage.setItem("userName", fullName);
        }
        await afterAuthSuccess(router);
      }
    }
    setLoading(false);
  }

  return (
    <Starfield twinkle>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.header, SpaceStyles.glowText, SpaceStyles.wordmark]}>MovieSpaces</Text>
        <Text style={styles.subHeader}>
          {isSignUp ? "Create a new account" : "Sign in to your account"}
        </Text>

        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={12}
            style={styles.appleButton}
            onPress={handleAppleSignIn}
          />
        )}

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.googleButton}
          onPress={handleGoogleSignIn}
          disabled={ssoLoading !== null || loading}
        >
          {ssoLoading === "google" ? (
            <ActivityIndicator color={SpaceTheme.backgroundVoid} />
          ) : (
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        {isSignUp && (
          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={SpaceTheme.mutedOrbit}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={SpaceTheme.mutedOrbit}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={SpaceTheme.mutedOrbit}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
        />
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.button}
          onPress={handleAuth}
          disabled={loading || ssoLoading !== null}
        >
          {loading ? (
            <ActivityIndicator color={SpaceTheme.backgroundVoid} />
          ) : (
            <Text style={styles.buttonText}>
              {isSignUp ? "Register" : "Login"}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setIsSignUp(!isSignUp)}
          style={styles.switchLink}
        >
          <Text style={styles.switchText}>
            {isSignUp
              ? "Already have an account? Sign In"
              : "Don't have an account? Sign Up"}
          </Text>
        </TouchableOpacity>

        {!isSignUp && (
          <TouchableOpacity
            onPress={() => router.push("/reset-password")}
            style={styles.forgotLink}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        {isSignUp && (
          <Text style={styles.legalText}>
            By registering, you agree to our{" "}
            <Text style={styles.legalLink} onPress={() => router.push("/legal/terms")}>
              Terms of Service
            </Text>{" "}
            and{" "}
            <Text style={styles.legalLink} onPress={() => router.push("/legal/privacy")}>
              Privacy Policy
            </Text>
            .
          </Text>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
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
    fontSize: 16,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginBottom: 32,
  },
  appleButton: {
    width: "100%",
    height: 50,
    marginBottom: 12,
  },
  googleButton: {
    ...SpaceStyles.glassCard,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  googleButtonText: { color: SpaceTheme.starWhite, fontSize: 16, fontWeight: "700" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  dividerText: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 12,
    fontWeight: "700",
    marginHorizontal: 12,
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
  switchLink: { marginTop: 24, alignItems: "center" },
  switchText: { color: SpaceTheme.mutedOrbit, fontSize: 14 },
  forgotLink: { marginTop: 14, alignItems: "center" },
  forgotText: { color: SpaceTheme.glowCyan, fontSize: 14, fontWeight: "600" },
  legalText: {
    marginTop: 16,
    fontSize: 12,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    lineHeight: 18,
  },
  legalLink: { color: SpaceTheme.glowCyan, fontWeight: "600" },
});
