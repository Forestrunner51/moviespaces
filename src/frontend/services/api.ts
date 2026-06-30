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

  // DO NOT throw a raw error here anymore!
  // Just pass the response back down the line so the components can check res.ok safely.
  return response;
}
