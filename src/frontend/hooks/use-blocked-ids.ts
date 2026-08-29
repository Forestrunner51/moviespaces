import { useEffect, useSyncExternalStore } from "react";
import {
  getBlockedIdsSnapshot,
  loadBlockedIds,
  subscribeBlockedIds,
} from "@/frontend/services/moderation";

// The set of user ids the current user has blocked, from the shared cache in
// services/moderation.ts. Kicks off the (single, shared) load on first use and
// re-renders when blockUser/unblockUser change it — so a block made in one
// screen is reflected everywhere without each screen re-querying.
export function useBlockedIds(): ReadonlySet<string> {
  const ids = useSyncExternalStore(subscribeBlockedIds, getBlockedIdsSnapshot, getBlockedIdsSnapshot);
  useEffect(() => {
    loadBlockedIds().catch(() => {});
  }, []);
  return ids;
}
