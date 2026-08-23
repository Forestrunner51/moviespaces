import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { AvatarStack } from "@/frontend/components/avatar";
import { SpaceStyles, Palette, Type, Display, Font, Radius } from "@/frontend/constants/theme";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { formatEventDate } from "@/frontend/utils/event-date";
import { EVENT_CATEGORIES, eventCategoryOf } from "@/frontend/constants/event-categories";

export interface NextUpSpace {
  id: string;
  filmName: string;
  cinemaName: string;
  posterPath: string | null;
  showDate: string;
  showTime: string;
  screeningTime: string | null;
  spaceType: string;
  eventCategory: string | null;
  matchMovieKey?: string | null;
  members: { userId: string; name: string; hasTicket?: boolean }[];
}

// "Your next thing" — the Timeleft card. One big object about the soonest
// Space/crew you're in: poster, when (with the countdown), where, and the
// faces of who's coming. A social app's home leads with the user's life,
// not the app's menu; this is what that looks like here.
export function NextUpCard({ space }: { space: NextUpSpace }) {
  const members = space.members ?? [];
  const profiles = useProfiles(members.map((m) => m.userId));
  const eventDate = formatEventDate(space.screeningTime, space.showDate, space.showTime);
  const isCrew = !!space.matchMovieKey;
  const ticketed = members.filter((m) => m.hasTicket).length;
  const hasPlan = !!space.screeningTime || !!space.cinemaName;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      style={styles.nextCard}
      onPress={() => router.push({ pathname: "/group", params: { groupId: space.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Your next: ${space.filmName}`}
    >
      <View style={styles.nextTop}>
        <MoviePoster
          uri={space.posterPath}
          width={84}
          fallbackIcon={EVENT_CATEGORIES[eventCategoryOf(space.spaceType, space.eventCategory)].icon}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.nextKicker}>
            {isCrew ? (space.spaceType === "private_rental" ? "Your watch party crew" : "Your theater crew") : "Your next Space"}
          </Text>
          <Text style={styles.nextTitle} numberOfLines={2}>
            {space.filmName}
          </Text>
          {hasPlan ? (
            <>
              <View style={styles.nextWhen}>
                <Text style={styles.nextDate}>{eventDate.date}</Text>
                {!!eventDate.time && <Text style={styles.nextTime}>{eventDate.time}</Text>}
              </View>
              <Text style={styles.nextWhere} numberOfLines={1}>
                {space.cinemaName}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.nextWhere}>No showtime yet</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.nextSetLink}
                onPress={() =>
                  router.push({ pathname: "/group", params: { groupId: space.id, openEdit: "1" } })
                }
                hitSlop={6}
                accessibilityRole="button"
              >
                <Ionicons name="calendar-outline" size={13} color={Palette.accent} />
                <Text style={styles.nextSetLinkText}>Set the showtime</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
      <View style={styles.nextBottom}>
        {members.length > 0 ? (
          <View style={styles.nextPeople}>
            <AvatarStack
              people={members.map((m) => ({
                userId: m.userId,
                name: m.name,
                avatarUrl: profiles.get(m.userId)?.avatarUrl,
              }))}
              size={26}
              max={5}
            />
            <Text style={styles.nextPeopleText}>
              {members.length} going{isCrew && ticketed > 0 ? ` · ${ticketed} ticketed` : ""}
            </Text>
          </View>
        ) : (
          <View />
        )}
        {!!eventDate.relative && (
          <View style={styles.nextCountdown}>
            <Text style={styles.nextCountdownText}>{eventDate.relative}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Next up
  nextCard: {
    ...SpaceStyles.glassCard,
    borderColor: Palette.accentBorder,
    padding: 16,
    marginBottom: 4,
  },
  nextTop: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  nextKicker: {
    ...Type.caption,
    fontFamily: Font.semibold,
    color: Palette.accent,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  nextTitle: { fontFamily: Font.bold, fontSize: 22, lineHeight: 26, color: Palette.text, marginBottom: 6 },
  nextWhen: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  nextDate: { ...Display.date, color: Palette.text },
  nextTime: { ...Display.stat, color: Palette.textMuted },
  nextWhere: { ...Type.small, color: Palette.textMuted, marginTop: 2 },
  nextSetLink: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, alignSelf: "flex-start" },
  nextSetLinkText: { ...Type.small, fontFamily: Font.semibold, color: Palette.accent },
  nextBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  nextPeople: { flexDirection: "row", alignItems: "center", gap: 8 },
  nextPeopleText: { ...Type.caption, color: Palette.textMuted },
  nextCountdown: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: Palette.accent,
  },
  nextCountdownText: { ...Type.caption, fontFamily: Font.bold, color: Palette.base, textTransform: "uppercase", letterSpacing: 0.5 },
});
