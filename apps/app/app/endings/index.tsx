import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { listStarterStoryDefinitions } from "@cyoa/stories";

import { EndingsMap, TrophyCrypt, type EndingNode } from "../../components/endings";
import { Text } from "../../components/primitives";
import { guestAuthArgs, useGuestSession } from "../../hooks/useGuestSession";
import { useLibrary } from "../../hooks/useLibrary";
import { useTrophyCinematics } from "../../hooks/useTrophyCinematics";
import { hasRemoteGameApi } from "../../lib/gameApi";
import { preferredPathHint, prettifyEndingLabel } from "../../lib/endingLabels";
import { listRemoteUnlockedEndings, type RemoteUnlockedEnding } from "../../lib/endingsApi";
import type { RemoteCinematicView } from "../../lib/cinematicApi";
import { useAppTheme } from "../../theme";

const NEW_BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function endingKey(storyId: string, endingId: string): string {
  return `${storyId}:${endingId}`;
}

/**
 * Build the trophy-crypt node list: the authored ending catalog (every ending
 * declared across the starter stories) unioned with the reader's server-side
 * unlocks. Authored endings the reader hasn't reached render as locked/hidden;
 * unlocked ones surface with their recorded path and a "★ NEW" badge when
 * recently earned. Server unlocks not present in any authored catalog (e.g.
 * llm-driven or safety endings) are appended as unlocked nodes.
 */
function buildEndingNodes(
  unlocks: RemoteUnlockedEnding[],
  now: number,
  // Best endpoint cinematic per raw endingId, aggregated across the
  // reader's saves (C5 — cinematics are per-save; the crypt surfaces the
  // playable one for each unlocked ending).
  cinematicsByEndingId: Record<string, RemoteCinematicView>,
): EndingNode[] {
  const unlockByKey = new Map<string, RemoteUnlockedEnding>();
  for (const u of unlocks) unlockByKey.set(endingKey(u.storyId, u.endingId), u);

  const nodes: EndingNode[] = [];
  const seen = new Set<string>();

  for (const def of listStarterStoryDefinitions()) {
    for (const ending of Object.values(def.story.endings)) {
      const key = endingKey(def.story.id, ending.id);
      seen.add(key);
      const unlock = unlockByKey.get(key);
      const cinematic = cinematicsByEndingId[ending.id];
      // Prefer the server-persisted choice labels (`pathLabels`); legacy rows
      // fall back to the recorded node-id path, which can contain synthetic
      // `storyId:llm:N` ids — preferredPathHint drops those and title-cases
      // the readable slugs, so machine hints never surface.
      const pathHint = unlock
        ? preferredPathHint(unlock.pathLabels, unlock.path)
        : undefined;
      nodes.push({
        id: key,
        title: ending.label,
        unlocked: Boolean(unlock),
        ...(pathHint ? { pathHint } : {}),
        ...(unlock && now - unlock.firstSeen < NEW_BADGE_WINDOW_MS ? { isNew: true } : {}),
        ...(unlock && cinematic ? { cinematic } : {}),
      });
    }
  }

  // Append unlocks that aren't in any authored catalog (llm-driven / safety).
  for (const u of unlocks) {
    const key = endingKey(u.storyId, u.endingId);
    if (seen.has(key)) continue;
    seen.add(key);
    const cinematic = cinematicsByEndingId[u.endingId];
    // Prefer a server-persisted label; fall back to a title-cased slug so
    // kebab-case endingIds ("grim-harvest") read as trophies, and machine
    // ids never leak (see lib/endingLabels.ts). Same preference for the path
    // hint: server choice labels first, prettified node ids for legacy rows.
    const pathHint = preferredPathHint(u.pathLabels, u.path);
    nodes.push({
      id: key,
      title: u.safetyEnding ? "A safe close" : prettifyEndingLabel(u.endingId, u.label),
      unlocked: true,
      ...(pathHint ? { pathHint } : {}),
      ...(now - u.firstSeen < NEW_BADGE_WINDOW_MS ? { isNew: true } : {}),
      ...(cinematic ? { cinematic } : {}),
    });
  }

  return nodes;
}

/**
 * Trophy crypt entry point. Every color/spacing/typography value resolves
 * through `useAppTheme().tokens` so the surface paints correctly in day,
 * night, and sepia. Ending data is live: unlocked endings come from the
 * account's `endings_unlocked` rows via `listUnlockedEndings`.
 */
export default function EndingsRoute() {
  const { tokens } = useAppTheme();
  const guest = useGuestSession();
  const library = useLibrary(guest.session);
  const [unlocks, setUnlocks] = useState<RemoteUnlockedEnding[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!guest.session || !hasRemoteGameApi()) {
      setUnlocks([]);
      return;
    }
    void listRemoteUnlockedEndings({
      accountId: guest.session.accountId,
      ...guestAuthArgs(),
    }).then((rows) => {
      if (!cancelled && rows) setUnlocks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [guest.session]);

  // Ending cinematics across the reader's terminal saves (per-save, C5),
  // aggregated to the best playable cinematic per endingId for the crypt.
  const terminalSaveIds = useMemo(
    () =>
      library.saves
        .filter(
          (s) =>
            s.status === "dead" || s.status === "ended" || s.status === "ended_safely",
        )
        .map((s) => s.saveId),
    [library.saves],
  );
  const cinematicsByEndingId = useTrophyCinematics(
    guest.session?.accountId,
    terminalSaveIds,
  );

  const nodes = useMemo(
    () => buildEndingNodes(unlocks, Date.now(), cinematicsByEndingId),
    [unlocks, cinematicsByEndingId],
  );

  return (
    <ScrollView
      contentContainerStyle={{
        backgroundColor: tokens.colors.background,
        flexGrow: 1,
        gap: tokens.spacing.lg,
        padding: tokens.spacing.lg,
      }}
    >
      <View style={{ gap: tokens.spacing.sm, maxWidth: 760 }}>
        <Text
          style={{
            color: tokens.colors.textMuted,
            fontFamily: tokens.typography.families.mono,
            fontWeight: "800",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
          variant="caption"
        >
          Endings
        </Text>
        <Text variant="title">Known paths and hidden doors.</Text>
        <Text muted variant="bodySmall">
          Hidden endings stay concealed until they are earned.
        </Text>
      </View>
      <EndingsMap nodes={nodes} />
      <TrophyCrypt endings={nodes} />
    </ScrollView>
  );
}
