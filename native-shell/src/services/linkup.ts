import { callLinkUp } from '@/src/services/api';
import { supabase } from '@/src/services/supabase';

export type LinkUpPeer = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  bio?: string;
};

export type LinkUpPendingMatch = {
  matchId: string;
  reasonTags: string[];
  placeName: string | null;
  peer: LinkUpPeer;
};

export type LinkUpConversation = {
  matchId: string;
  conversationId: string;
  expiresAt: string;
  peer: LinkUpPeer;
};

export type LinkUpSnapshot = {
  enabled: boolean;
  paused: boolean;
  ghost: boolean;
  presence: { id: string; placeId: string; placeName: string | null; expiresAt: string } | null;
  pending: LinkUpPendingMatch[];
  waiting: LinkUpPendingMatch[];
  conversations: LinkUpConversation[];
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export async function probeLinkUp() {
  try {
    const result = await callLinkUp<{ ok?: boolean; probe?: boolean; disabled?: boolean }>(
      'linkup-presence',
      { action: 'probe' }
    );
    return Boolean(result.ok && result.probe) && !result.disabled;
  } catch {
    return false;
  }
}

async function placeNameFor(placeId: string) {
  const { data } = await supabase
    .from('canonical_places')
    .select('name, formatted_address')
    .eq('id', placeId)
    .maybeSingle();
  return text(data?.name) || text(data?.formatted_address) || null;
}

async function peerFor(matchId: string, userId: string) {
  const { data: members } = await supabase
    .from('linkup_match_members')
    .select('user_id')
    .eq('match_id', matchId);
  const peerId = (members ?? []).map((row) => text(row.user_id)).find((id) => id && id !== userId);
  if (!peerId) return null;
  const { data: profile } = await supabase.rpc('linkup_peer_profile', { target_user: peerId });
  const row = (Array.isArray(profile) ? profile[0] : profile) as Record<string, unknown> | null;
  return {
    userId: peerId,
    displayName: text(row?.display_name) || text(row?.username) || 'Someone',
    photoUrl: text(row?.profile_photo_url) || null,
    bio: text(row?.bio),
  };
}

export async function loadLinkUpSnapshot(userId: string): Promise<LinkUpSnapshot> {
  const enabled = await probeLinkUp();
  const nowIso = new Date().toISOString();

  const { data: profile } = await supabase
    .from('user_onboarding_profiles')
    .select('linkup_status')
    .eq('user_id', userId)
    .maybeSingle();
  const status = text(profile?.linkup_status);
  const ghost = status === 'ghost';
  const paused = Boolean(status) && status !== 'active' && status !== 'ghost';

  const { data: presences } = await supabase
    .from('linkup_presence')
    .select('id, place_id, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', nowIso)
    .order('arrived_at', { ascending: false })
    .limit(1);
  const presenceRow = presences?.[0];
  const presence = presenceRow
    ? {
        id: presenceRow.id,
        placeId: presenceRow.place_id,
        placeName: await placeNameFor(presenceRow.place_id),
        expiresAt: presenceRow.expires_at,
      }
    : null;

  const pending: LinkUpPendingMatch[] = [];
  const waiting: LinkUpPendingMatch[] = [];
  const conversations: LinkUpConversation[] = [];

  const { data: myMembers } = await supabase
    .from('linkup_match_members')
    .select('match_id, response')
    .eq('user_id', userId);
  const matchIds = (myMembers ?? []).map((row) => text(row.match_id)).filter(Boolean);
  const myResponses = new Map((myMembers ?? []).map((row) => [text(row.match_id), text(row.response)]));

  if (matchIds.length) {
    const { data: matches } = await supabase
      .from('linkup_matches')
      .select('id, status, expires_at, reason_tags, place_id')
      .in('id', matchIds)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });

    for (const match of matches ?? []) {
      if (match.status === 'pending' && new Date(match.expires_at).getTime() > Date.now()) {
        const peer = await peerFor(match.id, userId);
        if (!peer) continue;
        const row = {
          matchId: match.id,
          reasonTags: Array.isArray(match.reason_tags)
            ? match.reason_tags.filter((tag): tag is string => typeof tag === 'string')
            : [],
          placeName: await placeNameFor(match.place_id),
          peer,
        };
        if (myResponses.get(match.id) === 'accepted') waiting.push(row);
        else pending.push(row);
      } else if (match.status === 'accepted') {
        const { data: conversation } = await supabase
          .from('linkup_conversations')
          .select('id, expires_at')
          .eq('match_id', match.id)
          .maybeSingle();
        if (!conversation) continue;
        const peer = await peerFor(match.id, userId);
        if (!peer) continue;
        conversations.push({
          matchId: match.id,
          conversationId: conversation.id,
          expiresAt: conversation.expires_at,
          peer,
        });
      }
    }
  }

  return { enabled, paused, ghost, presence, pending, waiting, conversations };
}

export async function checkIn(placeId: string) {
  return callLinkUp<{
    ok: boolean;
    presence?: { id: string; expiresAt: string };
    proposedMatches?: number;
    ghost?: boolean;
  }>('linkup-presence', { action: 'checkin', placeId });
}

export async function checkOut() {
  return callLinkUp<{ ok: boolean }>('linkup-presence', { action: 'checkout' });
}

export async function respondToMatch(matchId: string, response: 'accepted' | 'declined') {
  return callLinkUp<{ ok: boolean; status: string }>('linkup-match', {
    action: 'respond',
    matchId,
    response,
  });
}

export async function endMatch(matchId: string) {
  return callLinkUp<{ ok: boolean }>('linkup-match', { action: 'end', matchId });
}
