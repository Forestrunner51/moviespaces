import { View, type StyleProp, type ViewStyle } from "react-native";
import { Palette } from "@/frontend/constants/theme";

// A small filled dot instead of 🟩/🟥 — an emoji square renders differently
// per OS/font, can't take its colour from the palette, and doesn't sit on
// the text baseline. Used everywhere the app marks a guess/answer as right
// or wrong: CineMind's guess history and results screen, the results page a
// friend opens from a shared link, and Roulette's practice-mode grading —
// one mark, one definition, instead of every screen picking its own emoji.
export function ResultDot({
  correct,
  style,
}: {
  correct: boolean;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[style, { backgroundColor: correct ? Palette.positive : Palette.danger }]} />
  );
}
