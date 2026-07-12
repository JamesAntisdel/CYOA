// Media spark price card (provider-and-credit-model design §2.1).
//
// 1 spark = $0.01 face value. These are the ONLY authoritative media prices;
// they replace the inverted `image*25 + video*20` constants that used to live
// inline in `paywall.ts:calculateOverageCents` (video was priced BELOW a still
// and below its own COGS). Verified COGS → 48–70% gross margin (design §2.1):
//
//   | media kind               | sparks | COGS          | margin  |
//   |--------------------------|--------|---------------|---------|
//   | scene still              |   15   | $0.045–0.067  | 55–70%  |
//   | narration chunk (TTS)    |    8   | $0.042        | 48%     |
//   | illustrated+narrated     |   25   | $0.09–0.11    | 56–64%  |
//   | Veo 4s clip              |   60   | $0.20         | 67%     |
//   | Omni endpoint cinematic  |  240   | $0.80         | 67%     |
//
// Update quarterly; costs sourced 2026-07-12.

/** The metered media products a spend can pay for. */
export type MediaSparkKind =
  | "scene_still"
  | "narration"
  | "illustrated_narrated"
  | "veo_clip"
  | "omni_cinematic";

/** Face value of one spark, in US cents. 1 spark = $0.01. */
export const SPARK_VALUE_CENTS = 1;

/** Authoritative spark price per media product (design §2.1). */
export const MEDIA_SPARK_COSTS: Record<MediaSparkKind, number> = {
  scene_still: 15,
  narration: 8,
  illustrated_narrated: 25,
  veo_clip: 60,
  omni_cinematic: 240,
};

/** Spark cost for a media product. */
export function mediaSparkCost(kind: MediaSparkKind): number {
  return MEDIA_SPARK_COSTS[kind];
}

/** Convert a spark amount to its cent value (1 spark = 1 cent). */
export function sparksToCents(sparks: number): number {
  return sparks * SPARK_VALUE_CENTS;
}
