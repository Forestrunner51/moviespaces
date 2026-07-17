import { useEffect, useState } from "react";
import { supabase } from "@/frontend/config/supabase";

export function useSpaceInterest(spaceId: string) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [interestedCount, setInterestedCount] = useState(0);
  const [isInterested, setIsInterested] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const refresh = async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("space_interests")
        .select("user_id")
        .eq("space_id", spaceId);
      if (error) throw error;
      setInterestedCount(data?.length ?? 0);
      if (currentUserId) {
        setIsInterested((data || []).some((row) => row.user_id === currentUserId));
      }
    } catch (err) {
      console.error("Error fetching space interest:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (spaceId && currentUserId) refresh();
  }, [spaceId, currentUserId]);

  const markInterested = async () => {
    if (!currentUserId) return { success: false, error: "Not authenticated" };
    try {
      const { error } = await supabase
        .from("space_interests")
        .insert([{ space_id: spaceId, user_id: currentUserId }]);
      if (error && error.code !== "23505") throw error;
      await refresh();
      return { success: true };
    } catch (err: any) {
      console.error("Error marking interest:", err);
      return { success: false, error: err.message };
    }
  };

  const removeInterest = async () => {
    if (!currentUserId) return { success: false, error: "Not authenticated" };
    try {
      const { error } = await supabase
        .from("space_interests")
        .delete()
        .eq("space_id", spaceId)
        .eq("user_id", currentUserId);
      if (error) throw error;
      await refresh();
      return { success: true };
    } catch (err: any) {
      console.error("Error removing interest:", err);
      return { success: false, error: err.message };
    }
  };

  return { interestedCount, isInterested, loading, markInterested, removeInterest };
}
