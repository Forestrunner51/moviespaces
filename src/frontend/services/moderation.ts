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

export async function blockUser(blockedUserId: string): Promise<{ success: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not signed in." };

  const { error } = await supabase
    .from("blocks")
    .upsert({ blocker_id: user.id, blocked_id: blockedUserId }, { onConflict: "blocker_id,blocked_id" });

  if (error) return { success: false, error: error.message };
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
  return { success: true };
}

export async function getBlockedUserIds(): Promise<string[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", user.id);
  if (error) {
    console.error("Failed to load blocked users:", error);
    return [];
  }
  return (data || []).map((row) => row.blocked_id as string);
}
