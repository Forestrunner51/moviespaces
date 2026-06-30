import { supabase } from "../config/supabase";

export async function authFetch(url: string, options: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
  });

  if (response.status === 401) {
    throw new Error("Unauthorized - please log in again");
  }

  return response;
}
