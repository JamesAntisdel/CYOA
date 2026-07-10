import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CoopRoomScreen } from "../../components/coop";
import { CinematicMoment } from "../../components/media/CinematicMoment";
import { useGuestSession, guestAuthArgs } from "../../hooks/useGuestSession";
import { useLibrary, type LibrarySave } from "../../hooks/useLibrary";
import type { RemoteCinematicView } from "../../lib/cinematicApi";
import { getLocalStorage } from "../../lib/storage";
import {
  castCoopVoteRemote,
  closeCoopRoomRemote,
  createCoopRoomRemote,
  getCoopRoomRemote,
  getRoomCinematicRemote,
  hasCoopApi,
  heartbeatCoopRoomRemote,
  joinCoopRoomRemote,
  passCoopControlRemote,
  resolveCoopTurnRemote,
  rotateCoopInviteRemote,
  type CoopChoiceView,
  type CoopRoomView,
} from "../../lib/coopApi";
import { useAppTheme } from "../../theme";
import { Button, Chip, Field, Stamp, Surface, Text } from "../../components/primitives";

const MEMBERSHIP_KEY = "cyoa.coopRoom.v1";
const POLL_INTERVAL_MS = 3_000;

type Membership = { roomId: string; participantId: string; inviteToken?: string };

function readMembership(): Membership | null {
  try {
    const raw = getLocalStorage()?.getItem(MEMBERSHIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Membership>;
    if (typeof parsed.roomId === "string" && typeof parsed.participantId === "string") {
      return {
        roomId: parsed.roomId,
        participantId: parsed.participantId,
        ...(typeof parsed.inviteToken === "string" ? { inviteToken: parsed.inviteToken } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeMembership(membership: Membership | null): void {
  const storage = getLocalStorage();
  if (!storage) return;
  if (membership) storage.setItem(MEMBERSHIP_KEY, JSON.stringify(membership));
  else storage.removeItem(MEMBERSHIP_KEY);
}

/**
 * Live co-op room screen (Requirement 20). Replaces the previous hardcoded
 * demo: it creates / joins / polls a real `coop_rooms` room via `coopApi` and
 * wires the vote / pass-the-controller / host controls to the backend.
 *
 * Deep-link contract: an invite URL carries `?room=<roomId>&t=<inviteToken>`.
 * A visitor who follows one lands in the "join" panel; the host who just
 * created a room, and any returning member, are restored from localStorage.
 */
export default function CoopRoute() {
  const { tokens } = useAppTheme();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const params = useLocalSearchParams<{ room?: string; t?: string }>();

  const accountId = guest.session?.accountId ?? null;
  const auth = useMemo(() => guestAuthArgs(), [accountId]);

  const [membership, setMembership] = useState<Membership | null>(() => readMembership());
  const [room, setRoom] = useState<CoopRoomView | null>(null);
  const [choices, setChoices] = useState<CoopChoiceView[]>([]);
  // Req 10.2: the room's SHARED ending cinematic, playable by every participant.
  const [cinematic, setCinematic] = useState<RemoteCinematicView | null>(null);
  const [displayName, setDisplayName] = useState("Reader");
  const [mode, setMode] = useState<"pass" | "vote">("vote");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const invitePath = useCallback(
    (roomId: string, token: string) => {
      if (typeof window !== "undefined" && window.location) {
        const base = `${window.location.origin}${window.location.pathname}`;
        return `${base}?room=${encodeURIComponent(roomId)}&t=${encodeURIComponent(token)}`;
      }
      return `/coop?room=${encodeURIComponent(roomId)}&t=${encodeURIComponent(token)}`;
    },
    [],
  );

  const authArgs = useCallback(
    () => ({ ...(accountId ? { accountId } : {}), ...auth }),
    [accountId, auth],
  );

  // --- polling loop --------------------------------------------------------
  const membershipRef = useRef(membership);
  membershipRef.current = membership;
  useEffect(() => {
    if (!membership || !hasCoopApi()) return undefined;
    let cancelled = false;
    const tick = async () => {
      const current = membershipRef.current;
      if (!current) return;
      const result = await getCoopRoomRemote({
        roomId: current.roomId,
        participantId: current.participantId,
        ...authArgs(),
      });
      if (cancelled || !result) return;
      setRoom(result.room);
      setChoices(result.choices);
      // Req 10.2: poll for the shared ending cinematic. Null until the run
      // reaches an ending; upgrades in place as it generates → ready.
      void getRoomCinematicRemote({
        roomId: current.roomId,
        participantId: current.participantId,
        ...authArgs(),
      }).then((view) => {
        if (!cancelled) setCinematic(view);
      });
      // Best-effort presence heartbeat so the room shows us "online".
      void heartbeatCoopRoomRemote({
        roomId: current.roomId,
        participantId: current.participantId,
        ...authArgs(),
      });
    };
    void tick();
    const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [membership, authArgs]);

  const persist = useCallback((next: Membership | null) => {
    writeMembership(next);
    setMembership(next);
    if (!next) {
      setRoom(null);
      setChoices([]);
      setCinematic(null);
    }
  }, []);

  // --- actions -------------------------------------------------------------
  const handleCreate = useCallback(
    async (save: LibrarySave) => {
      if (!accountId) return;
      setBusy(true);
      setError(null);
      const result = await createCoopRoomRemote({
        accountId,
        ...auth,
        saveId: save.saveId,
        mode,
        displayName,
      });
      setBusy(false);
      if (!result) {
        setError("Could not create the room. Try again.");
        return;
      }
      setRoom(result.room);
      persist({ roomId: result.roomId, participantId: result.participantId, inviteToken: result.inviteToken });
    },
    [accountId, auth, displayName, mode, persist],
  );

  const handleJoin = useCallback(async () => {
    const roomId = typeof params.room === "string" ? params.room : null;
    const inviteToken = typeof params.t === "string" ? params.t : null;
    if (!roomId || !inviteToken) return;
    setBusy(true);
    setError(null);
    const result = await joinCoopRoomRemote({
      roomId,
      inviteToken,
      displayName,
      ...authArgs(),
    });
    setBusy(false);
    if (!result) {
      setError("Could not join the room. The invite may have expired.");
      return;
    }
    setRoom(result.room);
    persist({ roomId: result.roomId, participantId: result.participantId, inviteToken });
  }, [params.room, params.t, displayName, authArgs, persist]);

  const handleVote = useCallback(
    async (choiceId: string) => {
      if (!membership) return;
      const result = await castCoopVoteRemote({
        roomId: membership.roomId,
        participantId: membership.participantId,
        choiceId,
        ...authArgs(),
      });
      if (result) setRoom(result.room);
    },
    [membership, authArgs],
  );

  const handlePass = useCallback(
    async (_choiceId: string) => {
      if (!membership) return;
      // Pass-the-controller: submitting a choice hands control to the next
      // reader. The choice itself drives the shared save via the reader loop;
      // here we just advance the controller so the UI reflects whose turn it is.
      const result = await passCoopControlRemote({
        roomId: membership.roomId,
        participantId: membership.participantId,
        ...authArgs(),
      });
      if (result) setRoom(result.room);
    },
    [membership, authArgs],
  );

  const handleResolve = useCallback(async () => {
    if (!membership) return;
    const result = await resolveCoopTurnRemote({
      roomId: membership.roomId,
      participantId: membership.participantId,
      ...authArgs(),
    });
    if (result) setRoom(result.room);
  }, [membership, authArgs]);

  const handleCopyInvite = useCallback(async () => {
    if (!membership?.inviteToken || !room) return;
    const url = invitePath(membership.roomId, membership.inviteToken);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      }
    } catch {
      // Clipboard denied — the URL is still shown in the panel below.
    }
  }, [membership, room, invitePath]);

  const handleRotateInvite = useCallback(async () => {
    if (!membership) return;
    const result = await rotateCoopInviteRemote({
      roomId: membership.roomId,
      participantId: membership.participantId,
      ...authArgs(),
    });
    if (result) {
      setRoom(result.room);
      persist({ ...membership, inviteToken: result.inviteToken });
    }
  }, [membership, authArgs, persist]);

  const handleClose = useCallback(async () => {
    if (!membership) return;
    const result = await closeCoopRoomRemote({
      roomId: membership.roomId,
      participantId: membership.participantId,
      ...authArgs(),
    });
    if (result) setRoom(result.room);
  }, [membership, authArgs]);

  const handleLeave = useCallback(() => persist(null), [persist]);

  // --- rendering -----------------------------------------------------------
  if (!hasCoopApi()) {
    return (
      <Centered tokens={tokens}>
        <Stamp>co-op</Stamp>
        <Text variant="title">Co-op is offline</Text>
        <Text muted>Connect to the live backend to create or join a room.</Text>
      </Centered>
    );
  }

  if (!guest.session) {
    return (
      <Centered tokens={tokens}>
        <Stamp>co-op</Stamp>
        <Text variant="title">Sign in to play together</Text>
        <Text muted>Start a tale from the library first to get a reader session.</Text>
      </Centered>
    );
  }

  // Live room view.
  if (membership && room) {
    return (
      <View style={{ flex: 1 }}>
        <CoopRoomScreen
          choices={choices}
          currentParticipantId={membership.participantId}
          onCloseRoom={handleClose}
          onCopyInvite={handleCopyInvite}
          onPassChoice={handlePass}
          onRotateInvite={handleRotateInvite}
          onVote={handleVote}
          room={room}
        />
        <View style={{ padding: tokens.spacing.md, gap: tokens.spacing.sm }}>
          {cinematic ? (
            <View style={{ gap: tokens.spacing.xs }}>
              <Text muted variant="caption">
                Your shared ending cinematic
              </Text>
              <CinematicMoment cinematic={cinematic} muted={false} reducedMotion={false} />
            </View>
          ) : null}
          {membership.inviteToken ? (
            <Text muted>
              {copied ? "Invite copied." : invitePath(membership.roomId, membership.inviteToken)}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
            {room.mode === "vote" ? (
              <Button onPress={handleResolve} variant="ghost">
                Resolve vote
              </Button>
            ) : null}
            <Button onPress={handleLeave} variant="ghost">
              Leave room
            </Button>
          </View>
        </View>
      </View>
    );
  }

  // Join panel (arrived via invite URL).
  const joinRoomId = typeof params.room === "string" ? params.room : null;
  const joinToken = typeof params.t === "string" ? params.t : null;
  if (joinRoomId && joinToken) {
    return (
      <Centered tokens={tokens}>
        <Stamp>co-op invite</Stamp>
        <Text variant="title">Join the reading</Text>
        <Field
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Reader"
        />
        {error ? <Text style={{ color: tokens.colors.danger ?? "#c00" }}>{error}</Text> : null}
        <Button onPress={() => void handleJoin()} variant="primary">
          {busy ? "Joining…" : "Join room"}
        </Button>
      </Centered>
    );
  }

  // Create panel.
  const startableSaves = library.saves.filter((save) => save.status === "active");
  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: tokens.spacing.lg, gap: tokens.spacing.lg }}>
        <View style={{ gap: tokens.spacing.sm }}>
          <Stamp>co-op room</Stamp>
          <Text variant="title">Start a co-op reading</Text>
          <Text muted>Pick a save, choose how the group decides, and share the invite link.</Text>
        </View>

        <Surface padded>
          <View style={{ gap: tokens.spacing.md }}>
            <Field
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Reader"
        />
            <View style={{ flexDirection: "row", gap: tokens.spacing.sm }}>
              <Button onPress={() => setMode("vote")} variant={mode === "vote" ? "primary" : "ghost"}>
                Vote mode
              </Button>
              <Button onPress={() => setMode("pass")} variant={mode === "pass" ? "primary" : "ghost"}>
                Pass the controller
              </Button>
            </View>
          </View>
        </Surface>

        {error ? <Text style={{ color: tokens.colors.danger ?? "#c00" }}>{error}</Text> : null}
        {busy ? <ActivityIndicator /> : null}

        <View style={{ gap: tokens.spacing.sm }}>
          <Text variant="subtitle">Your saves</Text>
          {startableSaves.length === 0 ? (
            <Text muted>Start a tale from the library first, then bring friends in here.</Text>
          ) : (
            startableSaves.map((save) => (
              <Surface key={save.saveId} padded variant="muted">
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: tokens.spacing.sm,
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ flex: 1, gap: tokens.spacing.xs }}>
                    <Text>{save.title}</Text>
                    <Chip>turn {save.turnNumber}</Chip>
                  </View>
                  <Button onPress={() => void handleCreate(save)} variant="primary">
                    Host
                  </Button>
                </View>
              </Surface>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Centered({
  tokens,
  children,
}: {
  tokens: ReturnType<typeof useAppTheme>["tokens"];
  children: ReactNode;
}) {
  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <View
        style={{
          alignItems: "center",
          flex: 1,
          gap: tokens.spacing.md,
          justifyContent: "center",
          padding: tokens.spacing.lg,
        }}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}
