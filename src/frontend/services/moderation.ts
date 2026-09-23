import { supabase } from "@/frontend/config/supabase";

export type ReportTargetType = "message" | "space" | "user";

export async function reportContent(
  targetType: ReportTargetType,
  targetId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: targetType,
    target_id: targetId,
    reason: reason ?? null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// App Review guideline 1.2 requires that blocking ALSO notify the developer
// of the content that prompted it — a block that only mutes locally isn't
// enough. So every block files a `user` report alongside the block row.
// Best-effort: if the report insert fails the block still stands, because
// losing the mute is worse for the person doing the blocking than losing
// our copy of the notification.
export async function blockUser(
  blockedUserId: string,
  context?: string,
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  // ignoreDuplicates (ON CONFLICT DO NOTHING), not a plain upsert: the
  // blocks RLS has an insert policy and no update policy, so a DO UPDATE on
  // an existing row is refused — i.e. blocking someone you'd already blocked
  // failed. Re-blocking is a no-op anyway; there's nothing to update.
  const { error } = await supabase
    .from("blocks")
    .upsert(
      { blocker_id: user.id, blocked_id: blockedUserId },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
    );

  if (error) return { success: false, error: error.message };
  setBlockedCache(new Set([...blockedCache, blockedUserId]));

  const report = await reportContent(
    "user",
    blockedUserId,
    context ? `Blocked by user: ${context}` : "Blocked by user",
  );
  if (!report.success) {
    console.warn("Block recorded but the accompanying report failed:", report.error);
  }
  return { success: true };
}

export async function unblockUser(blockedUserId: string): Promise<{ success: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", blockedUserId);

  if (error) return { success: false, error: error.message };
  const next = new Set(blockedCache);
  next.delete(blockedUserId);
  setBlockedCache(next);
  return { success: true };
}

// --- Blocked-id cache -------------------------------------------------------
//
// Every place that hides a blocked user's content (both chats, both unread
// counters, friend requests) used to run its own `blocks` query on mount, so
// opening a chat cost four identical round-trips and the 15s pollers each
// re-asked. One module-level cache instead: loaded once per session, updated
// in place by blockUser/unblockUser, cleared on sign-out (see resetBlockedIds),
// and observable from React via useBlockedIds() in hooks/use-blocked-ids.ts.
const EMPTY: ReadonlySet<string> = new Set();
let blockedCache: ReadonlySet<string> = EMPTY;
let blockedLoaded = false;
let blockedInflight: Promise<ReadonlySet<string>> | null = null;
const blockedListeners = new Set<() => void>();

function setBlockedCache(next: ReadonlySet<string>) {
  blockedCache = next;
  blockedLoaded = true;
  blockedListeners.forEach((l) => l());
}

export function getBlockedIdsSnapshot(): ReadonlySet<string> {
  return blockedCache;
}

export function subscribeBlockedIds(listener: () => void): () => void {
  blockedListeners.add(listener);
  return () => {
    blockedListeners.delete(listener);
  };
}

// Sign-out / account switch: the next user must not inherit this list.
export function resetBlockedIds() {
  blockedCache = EMPTY;
  blockedLoaded = false;
  blockedInflight = null;
  blockedListeners.forEach((l) => l());
}

async function fetchBlockedIds(): Promise<ReadonlySet<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  // Preferred: blocked_peer_ids() returns blocks in BOTH directions (people
  // I blocked + people who blocked me) so neither side sees the other on
  // social surfaces. Falls back to my own outgoing blocks if the function
  // isn't applied yet (it's a hand-run migration).
  const rpc = await supabase.rpc("blocked_peer_ids");
  if (!rpc.error) {
    return new Set(((rpc.data as string[] | null) || []).map(String));
  }
  // Loud, not silent: without the function the both-direction guarantee
  // quietly degrades to outgoing-only, which is exactly the kind of
  // regression nobody notices until a blocked user reappears.
  console.warn("blocked_peer_ids RPC unavailable (migration applied?) — falling back to outgoing blocks only:", rpc.error.message);
  const { data, error } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", user.id);
  if (error) {
    console.error("Failed to load blocked users:", error);
    // Leave whatever we had rather than pretending nobody is blocked.
    return blockedCache;
  }
  return new Set((data || []).map((row) => row.blocked_id as string));
}

// Cached: resolves from memory after the first successful load. Concurrent
// first callers share one request. Pass { force: true } to refetch.
export async function loadBlockedIds(options: { force?: boolean } = {}): Promise<ReadonlySet<string>> {
  if (blockedLoaded && !options.force) return blockedCache;
  if (!blockedInflight) {
    blockedInflight = fetchBlockedIds()
      .then((ids) => {
        setBlockedCache(ids);
        return ids;
      })
      .finally(() => {
        blockedInflight = null;
      });
  }
  return blockedInflight;
}

// Kept for existing call sites — same cached data, array-shaped.
export async function getBlockedUserIds(): Promise<string[]> {
  return [...(await loadBlockedIds())];
}

// --- Blocked list (Settings → Safety) ---------------------------------------
//
// Reads the outgoing blocks directly rather than the cache: the cache holds
// peer ids in BOTH directions (see fetchBlockedIds), and you can only unblock
// people YOU blocked — showing someone who blocked you with an "Unblock"
// button next to them would be both confusing and a no-op.
export interface BlockedUser {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

export async function listBlockedUsers(): Promise<BlockedUser[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", user.id);
  if (error || !data || data.length === 0) return [];

  const ids = data.map((row) => row.blocked_id as string);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", ids);

  // A profile row can be missing (deleted account) — the block still exists
  // and must stay unblockable, so fall back to a placeholder rather than
  // dropping the row.
  return ids.map((id) => {
    const p = (profiles || []).find((row) => row.id === id);
    return {
      id,
      displayName: p?.display_name || "Blocked user",
      username: p?.username ?? null,
      avatarUrl: p?.avatar_url ?? null,
    };
  });
}
