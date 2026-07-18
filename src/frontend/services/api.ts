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

// authFetch can hang before the network request even starts — getSession()
// silently refreshes an expired token over the network, which is not covered
// by an AbortController on the fetch() call alone. This races the *entire*
// call against a timeout so screens gated on this never spin forever.
export async function authFetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  return Promise.race([
    authFetch(url, options),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), timeoutMs),
    ),
  ]);
}
