import { ScrollView, Text, StyleSheet } from "react-native";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import { LegalSection, LEGAL_LAST_UPDATED } from "@/frontend/constants/legal";

export function LegalDocument({ title, sections }: { title: string; sections: LegalSection[] }) {
  return (
    <Starfield>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, SpaceStyles.glowText]}>{title}</Text>
        <Text style={styles.updated}>Last updated {LEGAL_LAST_UPDATED}</Text>
        {sections.map((section) => (
          <Text key={section.heading} style={styles.section}>
            <Text style={styles.heading}>{section.heading}{"\n"}</Text>
            {section.body}
          </Text>
        ))}
      </ScrollView>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "bold", color: SpaceTheme.starWhite, marginBottom: 4 },
  updated: { fontSize: 12, color: SpaceTheme.mutedOrbit, marginBottom: 20 },
  section: { fontSize: 14, lineHeight: 21, color: SpaceTheme.starWhite, marginBottom: 20 },
  heading: { fontSize: 16, fontWeight: "700", color: SpaceTheme.glowCyan },
});
