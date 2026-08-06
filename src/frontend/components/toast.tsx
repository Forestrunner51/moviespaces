import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Palette, Radius, Type } from "@/frontend/constants/theme";

// Non-blocking feedback, for the cases where Alert.alert was doing a job it's
// wrong for.
//
// A native alert is a modal: it steals focus, has to be dismissed before the
// user can do anything else, can't be themed to match the app, and stacks
// badly when two fire in a row. That's the right shape for a question ("Delete
// this Space?") and the wrong shape for a statement ("Copied", "Please fill in
// your date and time") — most of the app's alerts were statements, so telling
// someone a field is empty required them to tap OK before they could go fill
// it in.
//
// Deliberately NOT a replacement for every alert: destructive confirmations
// still use Alert.alert, because there a blocking modal with an explicit
// Cancel is exactly what you want, and a toast someone can miss is not.
type ToastTone = "error" | "success" | "info";

interface ToastState {
  message: string;
  tone: ToastTone;
  // Bumped on every show() so an identical repeat message still restarts the
  // animation and timer — otherwise tapping a disabled action twice would
  // look like nothing happened the second time.
  nonce: number;
}

interface ToastApi {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const VISIBLE_MS = 3200;

// Module scope, matching the pattern in roulette.tsx: React Compiler can't
// verify that Reanimated's mutable `.value` assignment is safe inside a
// component closure and flags it as an illegal mutation. Out here it's just a
// function taking a SharedValue.
function fadeIn(progress: SharedValue<number>) {
  progress.value = withTiming(1, { duration: 180 });
}
function fadeOut(progress: SharedValue<number>) {
  progress.value = withTiming(0, { duration: 180 });
}

const TONE_STYLES: Record<ToastTone, { icon: keyof typeof Ionicons.glyphMap; color: string; border: string; fill: string }> = {
  error: { icon: "alert-circle", color: Palette.danger, border: Palette.dangerBorder, fill: Palette.dangerDim },
  success: { icon: "checkmark-circle", color: Palette.positive, border: Palette.positiveBorder, fill: Palette.positiveDim },
  info: { icon: "information-circle", color: Palette.accent, border: Palette.accentBorder, fill: Palette.surface },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "error") => {
    counter.current += 1;
    setToast({ message, tone, nonce: counter.current });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && <ToastBanner key={toast.nonce} toast={toast} onDone={() => setToast(null)} />}
    </ToastContext.Provider>
  );
}

function ToastBanner({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -12 }],
  }));

  useEffect(() => {
    fadeIn(progress);
    const hide = setTimeout(() => fadeOut(progress), VISIBLE_MS);
    // Cleared separately from the fade so onDone always runs even if the fade
    // callback is skipped (a backgrounded app can drop the animation frame).
    const done = setTimeout(onDone, VISIBLE_MS + 220);
    return () => {
      clearTimeout(hide);
      clearTimeout(done);
    };
  }, [progress, onDone]);

  const tone = TONE_STYLES[toast.tone];

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 8 }, style]}
      // Announced to VoiceOver/TalkBack without stealing focus — the whole
      // point is not interrupting, but a message nobody can hear is worse
      // than the alert this replaced.
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessible
      accessibilityLabel={toast.message}
    >
      <View style={[styles.banner, { borderColor: tone.border, backgroundColor: tone.fill }]}>
        <Ionicons name={tone.icon} size={18} color={tone.color} />
        <Text style={styles.text} numberOfLines={3}>
          {toast.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 9999 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingVertical: 12,
    paddingHorizontal: 14,
    // Sits over the app's own dark surfaces, so it needs its own elevation to
    // read as floating rather than as part of the screen beneath it.
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  text: { flex: 1, color: Palette.text, ...Type.small },
});
