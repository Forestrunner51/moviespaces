import { supabase } from "../config/supabase";

export async function authFetch(url: string, options: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const response = await fetch(url, {
    ...options,
    headers: {
      // Defaults first, caller's headers after, so a future caller CAN
      // override Content-Type (e.g. multipart) — Authorization stays last
      // because nothing should ever override the session token.
      "Content-Type": "application/json",
      ...options.headers,
      // Omitted entirely when there's no session (expired refresh token):
      // "Bearer " with nothing after it is a malformed header, and the
      // backend's 401 is clearer without one.
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
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
//
// The timer is cleared once the race settles — cinemind's screens pass a 45s
// cold-start timeout, and without cleanup every successful request left a
// live 45s timer behind (they pile up fast with pull-to-refresh).
export async function authFetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      authFetch(url, options),
      new Promise<Response>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
