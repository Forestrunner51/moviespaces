import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "../frontend/config/supabase";
import { useRouter } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceStyles, Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { signInWithGoogle, signInWithApple, isAppleSignInAvailable } from "@/frontend/services/sso";
import { hasOnboardedInterests, completeOnboarding } from "@/frontend/services/onboarding";
import { useToast } from "@/frontend/components/toast";

// Routes to the one-time genre-picker onboarding flow instead of straight
// into the app, unless this device has already been through it. Both branches
// converge on the same eventual outcome (land in the app, honoring a pending
// deep-link redirect) via completeOnboarding — the picker screen calls it
// once its own flow finishes, this just calls it directly when there's
// nothing to onboard.
async function afterAuthSuccess(router: ReturnType<typeof useRouter>) {
  if (await hasOnboardedInterests()) {
    await completeOnboarding();
  } else {
    router.replace("/onboarding-interests");
  }
}

export default function AuthScreen() {
  const { showToast } = useToast();
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
      showToast(result.error || "Couldn't sign in with Google. Please try again.");
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
      showToast(result.error || "Couldn't sign in with Apple. Please try again.");
    }
  };

  async function handleAuth() {
    if (!email || !password || (isSignUp && !name)) {
      showToast("Please fill in all fields.");
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
        showToast(error.message);
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
        showToast(
          `We sent a confirmation link to ${email.trim()}. Tap it to activate your account, then sign in.`,
          "success",
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
        showToast(error.message);
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
        <Text style={styles.header}>MovieSpaces</Text>
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
            <ActivityIndicator color={Palette.base} />
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
            placeholderTextColor={Palette.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={Palette.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={Palette.textMuted}
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
            <ActivityIndicator color={Palette.base} />
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
    ...Display.heading,
    color: Palette.text,
    textAlign: "center",
    marginBottom: 8,
  },
  subHeader: {
    ...Type.body,
    color: Palette.textMuted,
    textAlign: "center",
    marginBottom: 32,
  },
  appleButton: {
    width: "100%",
    height: 50,
    marginBottom: 12,
  },
  googleButton: {
    ...SpaceStyles.field,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  googleButtonText: { ...Type.body, color: Palette.text, fontWeight: "700" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Palette.border },
  dividerText: {
    ...Type.caption,
    color: Palette.textMuted,
    fontWeight: "700",
    marginHorizontal: 12,
  },
  input: {
    ...SpaceStyles.field,
    color: Palette.text,
    padding: 16,
    ...Type.body,
    marginBottom: 16,
  },
  button: {
    backgroundColor: Palette.accent,
    padding: 16,
    borderRadius: Radius.medium,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { ...Type.title, color: Palette.base, fontWeight: "700" },
  switchLink: { marginTop: 24, alignItems: "center" },
  switchText: { ...Type.small, color: Palette.textMuted },
  forgotLink: { marginTop: 14, alignItems: "center" },
  forgotText: { ...Type.small, color: Palette.accent, fontWeight: "600" },
  legalText: {
    marginTop: 16,
    ...Type.caption,
    color: Palette.textMuted,
    textAlign: "center",
  },
  legalLink: { color: Palette.accent, fontWeight: "600" },
});
