import { useEffect, useState } from "react";
import { supabase } from "@/frontend/config/supabase";

export interface PublicProfile {
  displayName: string | null;
  avatarUrl: string | null;
}

// Profiles live in Supabase, but Space members come from the .NET backend,
// which only knows a member's Name and Supabase UserId — it has no access to
// avatars. So anywhere we want to show faces for members we have to join the
// two, exactly as use-group-chat.ts already does for message senders.
//
// Cached module-wide rather than per-hook: the same handful of people recur
// across the Space screen, the Spaces list and Explore, and each mount would
// otherwise re-query for faces it has already fetched.
const cache = new Map<string, PublicProfile>();

export function useProfiles(userIds: (string | null | undefined)[]): Map<string, PublicProfile> {
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => !!id && id.length > 0)),
  ).sort();
  // Stable primitive dep — an array literal's identity changes every render.
  const idsKey = ids.join(",");

  const [, setVersion] = useState(0);

  useEffect(() => {
    const missing = ids.filter((id) => !cache.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", missing)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("Failed to load profiles:", error);
          return;
        }
        (data || []).forEach((row) => {
          cache.set(row.id, {
            displayName: row.display_name ?? null,
            avatarUrl: row.avatar_url ?? null,
          });
        });
        // Negative-cache the ones that came back with no row, so a member
        // whose profile was deleted doesn't get re-queried on every render.
        missing.forEach((id) => {
          if (!cache.has(id)) cache.set(id, { displayName: null, avatarUrl: null });
        });
        setVersion((v) => v + 1);
      });

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const result = new Map<string, PublicProfile>();
  ids.forEach((id) => {
    const hit = cache.get(id);
    if (hit) result.set(id, hit);
  });
  return result;
}
