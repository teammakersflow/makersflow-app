/**
 * realtimeNotifications.ts
 * ────────────────────────
 * Live notification delivery over Supabase Realtime.
 *
 * WHY THIS FILE EXISTS
 * The app previously had no Realtime subscription anywhere — notifications
 * only appeared when a screen regained focus and re-queried. So "real-time
 * notifications" never worked in-app: an announcement published from the admin
 * portal stayed invisible until the user navigated away and back.
 *
 * This subscribes to Postgres change events on:
 *   - `notifications`  (INSERT scoped to the signed-in user)
 *   - `announcements`  (INSERT + UPDATE, broadcast to everyone)
 *
 * IMPORTANT — enable Realtime on both tables first, or nothing arrives:
 *   alter publication supabase_realtime add table public.notifications;
 *   alter publication supabase_realtime add table public.announcements;
 * (Also included in the migration SQL.)
 */

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type RealtimeNotification = {
  id: string;
  title: string;
  body: string | null;
  type: string | null;
  link: string | null;
  created_at: string;
  isAnnouncement?: boolean;
};

type Handlers = {
  /** Fired when a new personal notification or published announcement lands. */
  onNotification?: (n: RealtimeNotification) => void;
  /** Fired on any change — use to refresh an unread badge count. */
  onChange?: () => void;
};

/**
 * Subscribe to live notifications for a user.
 * Returns an unsubscribe function. Safe to call with an undefined userId
 * (it simply does nothing until one is available).
 */
export function subscribeToNotifications(
  userId: string | undefined,
  handlers: Handlers
): () => void {
  if (!userId) return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`notifications:${userId}`)
    // ── Personal notifications ───────────────────────────────────────────
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        handlers.onNotification?.({
          id: String(row.id),
          title: String(row.title ?? 'Notification'),
          body: (row.body as string) ?? null,
          type: (row.type as string) ?? null,
          link: (row.link as string) ?? null,
          created_at: String(row.created_at ?? new Date().toISOString()),
        });
        handlers.onChange?.();
      }
    )
    // ── Broadcast announcements ──────────────────────────────────────────
    // Listen to UPDATE too: the admin portal commonly saves a draft first and
    // flips status to 'published' afterwards, which arrives as an UPDATE.
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'announcements' },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row.status !== 'published') return;
        handlers.onNotification?.({
          id: `ann-${row.id}`,
          title: String(row.title ?? 'Announcement'),
          body: (row.message as string) ?? null,
          type: (row.type as string) ?? 'announcement',
          link: (row.link_url as string) ?? null,
          created_at: String(row.created_at ?? new Date().toISOString()),
          isAnnouncement: true,
        });
        handlers.onChange?.();
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'announcements' },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        const prev = payload.old as Record<string, unknown>;
        // Only fire on the draft → published transition, never on later edits.
        if (row.status !== 'published' || prev?.status === 'published') return;
        handlers.onNotification?.({
          id: `ann-${row.id}`,
          title: String(row.title ?? 'Announcement'),
          body: (row.message as string) ?? null,
          type: (row.type as string) ?? 'announcement',
          link: (row.link_url as string) ?? null,
          created_at: String(row.created_at ?? new Date().toISOString()),
          isAnnouncement: true,
        });
        handlers.onChange?.();
      }
    );

  channel.subscribe((status) => {
    if (__DEV__) console.log('[Realtime] notifications channel:', status);
  });

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * React hook wrapper. Handlers are held in a ref so passing inline arrow
 * functions doesn't tear down and rebuild the channel on every render.
 */
export function useRealtimeNotifications(
  userId: string | undefined,
  handlers: Handlers
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToNotifications(userId, {
      onNotification: (n) => handlersRef.current.onNotification?.(n),
      onChange: () => handlersRef.current.onChange?.(),
    });
    return unsubscribe;
  }, [userId]);
}
