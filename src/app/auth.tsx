import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../frontend/config/supabase";
import { useRouter } from "expo-router";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

export default function AuthScreen() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

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
      } else {
        await AsyncStorage.setItem("userName", name.trim());
        router.replace("/"); // go straight in, no confirmation needed
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
        router.replace("/");
      }
    }
    setLoading(false);
  }

  return (
    <Starfield>
      <View style={styles.container}>
        <Text style={[styles.header, SpaceStyles.glowText]}>MovieSpaces</Text>
        <Text style={styles.subHeader}>
          {isSignUp ? "Create a new account" : "Sign in to your account"}
        </Text>

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
          disabled={loading}
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
    fontSize: 16,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginBottom: 32,
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
});
