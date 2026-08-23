import { forwardRef } from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextProps,
  type TextInputProps,
} from "react-native";

// App-wide cap on OS "Larger Text" / Dynamic Type scaling. Without a cap a
// large accessibility text size scales every label and input without limit
// and pushes copy out of its container — the "text looks stretched on some
// devices" report. 1.3 keeps real accessibility scaling inside the layouts.
//
// This is a wrapper, not `Text.defaultProps = {...}`: React 19 dropped
// defaultProps on function components, and RN's Text/TextInput are function
// components, so the old assignment in _layout.tsx silently did nothing.
// Every screen imports Text/TextInput from here instead of react-native.
export const MAX_FONT_SCALE = 1.3;

export const Text = forwardRef<RNText, TextProps>(function Text(props, ref) {
  return <RNText ref={ref} maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} />;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(props, ref) {
  return <RNTextInput ref={ref} maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} />;
});
