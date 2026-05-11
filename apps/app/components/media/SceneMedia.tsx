import type { StreamingScene } from "../../hooks/useStreamingScene";
import { useMediaPreferences } from "../../hooks/useMediaPreferences";
import { AmbientSoundscape } from "./AmbientSoundscape";
import { MediaPlate } from "./MediaPlate";

type SceneMediaProps = {
  media: StreamingScene["media"];
  muted?: boolean;
  appActive?: boolean;
  reducedMotion?: boolean;
};

/**
 * SceneMedia is now a thin orchestrator:
 *
 *   - <AmbientSoundscape />  drives the audio ride-along (Audio agent owns).
 *   - <MediaPlate />         renders the four-state visual plate (task 28).
 *
 * Public surface is preserved so callers in components/reading/* keep working.
 */
export function SceneMedia({
  appActive,
  media,
  muted,
  reducedMotion,
}: SceneMediaProps) {
  const preferences = useMediaPreferences();
  const resolvedReducedMotion = reducedMotion ?? preferences.reducedMotion;
  const resolvedMuted = muted ?? preferences.muted ?? preferences.nativeBackground;
  const resolvedAppActive = appActive ?? preferences.appActive;

  if (!media || media.status === "idle") return null;

  const ambient = (
    <AmbientSoundscape
      appActive={resolvedAppActive}
      loop={media.ambient}
      muted={resolvedMuted}
      reducedMotion={resolvedReducedMotion}
    />
  );

  // Audio-only scenes don't render a visual plate — just the ambient loop.
  if (media.kind === "audio") return ambient;

  return (
    <>
      {ambient}
      <MediaPlate media={media} reducedMotion={resolvedReducedMotion} />
    </>
  );
}
