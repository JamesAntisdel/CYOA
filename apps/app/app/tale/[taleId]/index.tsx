import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Chip, Divider, Stamp, Surface, Text } from "../../../components/primitives";
import { ReportButton } from "../../../components/moderation";
import { CinematicMoment } from "../../../components/media/CinematicMoment";
import type { RemoteCinematicView } from "../../../lib/cinematicApi";
import {
  forkRemoteTale,
  readRemoteTale,
  type RemoteTaleReadAlong,
} from "../../../lib/talesApi";
import { guestAuthArgs, useGuestSession } from "../../../hooks/useGuestSession";
import { useAppTheme } from "../../../theme";

export default function TaleReadAlongRoute() {
  const { taleId } = useLocalSearchParams<{ taleId: string }>();
  const router = useRouter();
  const guest = useGuestSession();
  const { tokens } = useAppTheme();

  const [tale, setTale] = useState<RemoteTaleReadAlong | null>(null);
  const [status, setStatus] = useState("Loading tale…");
  const [forking, setForking] = useState(false);

  const load = useCallback(async () => {
    if (!taleId) return;
    setStatus("Loading tale…");
    try {
      const result = await readRemoteTale({
        taleId,
        ...(guest.session ? { accountId: guest.session.accountId } : {}),
        ...guestAuthArgs(),
      });
      if (!result) {
        setStatus("This tale is unavailable — it may be private, mature-gated, or unpublished.");
        setTale(null);
        return;
      }
      setTale(result);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "tale_load_failed");
    }
  }, [taleId, guest.session]);

  useEffect(() => {
    void load();
  }, [load]);

  const fork = async (sourceTurnId: string) => {
    if (!guest.session) {
      setStatus("Start a session before forking.");
      return;
    }
    if (!taleId) return;
    setForking(true);
    setStatus("Forking a new save from this decision…");
    try {
      const result = await forkRemoteTale({
        taleId,
        sourceTurnId,
        accountId: guest.session.accountId,
        ...guestAuthArgs(),
      });
      if (!result) {
        setStatus("Fork was blocked — the publisher may have disabled forking.");
        return;
      }
      router.push(`/read/${result.saveId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "fork_failed");
    } finally {
      setForking(false);
    }
  };

  const forkingAllowed = tale ? tale.forkPolicy !== "disabled" && !tale.revoked : false;

  // Req 10.1: the featured cinematic is the hook. The server denormalizes a
  // ready ending-cinematic URL onto the tale, so we can render it directly via
  // the shared CinematicMoment surface without a separate media fetch.
  const leadCinematic: RemoteCinematicView | null = tale?.leadCinematic?.url
    ? {
        assetId: tale.leadCinematic.assetId,
        cinematicTrigger: "ending",
        status: "ready",
        url: tale.leadCinematic.url,
        hasAudio: tale.leadCinematic.hasAudio,
        ...(tale.leadCinematic.endingId ? { endingId: tale.leadCinematic.endingId } : {}),
      }
    : null;

  return (
    <SafeAreaView style={{ backgroundColor: tokens.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={{ marginHorizontal: "auto", maxWidth: 760, padding: tokens.spacing.xl, width: "100%" }}>
        <View style={{ gap: tokens.spacing.lg }}>
          <View style={{ gap: tokens.spacing.sm }}>
            <Stamp>read along</Stamp>
            <Text variant="title">{tale?.title ?? "Published tale"}</Text>
            {tale?.synopsis ? <Text muted>{tale.synopsis}</Text> : <Text muted>{taleId}</Text>}
          </View>
          {leadCinematic ? (
            <CinematicMoment cinematic={leadCinematic} muted={false} reducedMotion={false} />
          ) : null}
          <Surface padded>
            <View style={{ gap: tokens.spacing.md }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.spacing.sm }}>
                <Chip>Read-only</Chip>
                <Chip>Immutable snapshot</Chip>
                {tale ? <Chip variant="muted">{tale.privacy}</Chip> : null}
                {tale && !forkingAllowed ? <Chip variant="muted">Forking off</Chip> : null}
              </View>
              <Divider />
              {tale && tale.turns.length > 0 ? (
                tale.turns.map((turn) => (
                  <View key={turn.sourceTurnId} style={{ gap: tokens.spacing.xs }}>
                    <Text variant="caption" muted>Turn {turn.turnNumber}</Text>
                    {turn.prose ? <Text>{turn.prose}</Text> : null}
                    {forkingAllowed ? (
                      <Button
                        accessibilityLabel={`Fork from turn ${turn.turnNumber}`}
                        disabled={forking}
                        onPress={() => fork(turn.sourceTurnId)}
                        variant="ghost"
                      >
                        Fork from this decision
                      </Button>
                    ) : null}
                  </View>
                ))
              ) : null}
              {status ? <Text accessibilityLabel="Tale status" muted>{status}</Text> : null}
              <Divider />
              {/* UGC report path (Apple 1.2 / Play UGC). Present on every
                  published tale so a reader can always flag it for review. */}
              {taleId ? (
                <ReportButton
                  targetType="tale"
                  targetId={taleId}
                  targetLabel={tale?.title ?? "this tale"}
                />
              ) : null}
            </View>
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
