import type { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { Palette } from "@/frontend/constants/theme";

interface StarfieldProps {
  children?: ReactNode;
  // Accepted and ignored. Kept so the ~20 existing call sites don't all have
  // to change at once; both were only ever inputs to the star field.
  starCount?: number;
  twinkle?: boolean;
}

// The app's background wrapper.
//
// This used to render a procedural field of ~90 absolutely-positioned white
// dots (plus 10 animated ones on some screens) behind every screen in the
// app. Two reasons it's gone:
//
//  - It was the most literal expression of a space metaphor that had nothing
//    to do with the product. MovieSpaces is about getting people together to
//    watch something; a starfield says "astronomy app".
//  - Decorative noise behind real content — posters, avatars, event details —
//    competes with it. Event apps this is measured against (Partiful, Luma)
//    are calm backgrounds with the content carrying all the interest.
//
// A flat warm ground also stops costing 90 views on every single screen.
//
// The name is kept for now purely to avoid a rename across every screen in
// one go; there's nothing star-related left inside it.
export function Starfield({ children }: StarfieldProps) {
  return <View style={styles.container}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.base },
});
