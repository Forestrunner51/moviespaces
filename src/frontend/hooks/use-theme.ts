/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from "@/frontend/constants/theme";
import { useColorScheme } from "@/frontend/hooks/use-color-scheme";

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === "unspecified" ? "light" : scheme;

  return Colors[theme];
}
