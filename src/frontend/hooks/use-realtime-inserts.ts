import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { supabase } from "@/frontend/config/supabase";

// Subscribes to INSERTs on one Supabase table (optionally filtered) while the
// screen is mounted AND the app is in the foreground, and reports whether the
// subscription is currently healthy.
//
// This is an accelerator for the chat pollers, not a replacement: use-chat and
// use-group-chat keep useForegroundPoll running underneath and only stretch
// its interval while `connected` is true. That keeps every guarantee polling
// gave — a dropped socket, a missed event, a Realtime outage, or a table that
// isn't in the publication yet all degrade to "messages arrive within 4s"
// rather than "messages stop". The interval change itself triggers an
// immediate fetch (useForegroundPoll ticks on restart), so every connect and
// disconnect doubles as a catch-up read for anything the socket missed.
//
// Foreground-only for the same reason the pollers are: iOS tears the socket
// down when the app suspends anyway, and realtime-js would otherwise burn
// reconnect attempts in the background nobody is watching.
//
// Access control is Supabase's: postgres_changes evaluates the table's SELECT
// RLS policy per subscriber, so a member sees exactly the rows a query would
// return and nothing more. The `filter` here is a bandwidth hint, not a
// security boundary.
//
// `onInsert` is read through a ref so callers can pass an unmemoized closure
// without re-subscribing on every render.
export function useRealtimeInserts<Row extends object>(opts: {
  table: string;
  // PostgREST-style column filter, e.g. `group_id=eq.${id}`. Realtime supports
  // exactly one.
  filter?: string;
  enabled: boolean;
  onInsert: (row: Row) => void;
}): boolean {
  const { table, filter, enabled } = opts;
  const [connected, setConnected] = useState(false);
  const onInsertRef = useRef(opts.onInsert);
  useEffect(() => {
    onInsertRef.current = opts.onInsert;
  });

  useEffect(() => {
    if (!enabled) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const open = () => {
      if (channel) return;
      // Topic must be unique per live subscription — supabase-js hands back
      // the SAME channel object for a repeated topic, and two screens (or a
      // fast remount) would then fight over one subscription's lifecycle.
      const topic = `inserts:${table}:${filter ?? "*"}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table, ...(filter ? { filter } : {}) },
          (payload) => {
            onInsertRef.current(payload.new as Row);
          },
        )
        .subscribe((status) => {
          // status is realtime-js's REALTIME_SUBSCRIBE_STATES string enum;
          // anything other than SUBSCRIBED (TIMED_OUT, CLOSED, CHANNEL_ERROR)
          // hands the chat back to the 4s poll.
          setConnected(String(status) === "SUBSCRIBED");
        });
    };

    const close = () => {
      if (!channel) return;
      const c = channel;
      channel = null;
      setConnected(false);
      supabase.removeChannel(c).catch(() => {});
    };

    if (AppState.currentState === "active") open();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") open();
      else close();
    });

    return () => {
      sub.remove();
      close();
    };
  }, [table, filter, enabled]);

  return connected;
}
