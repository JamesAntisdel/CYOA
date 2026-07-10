// Registered reader-facing queries for endpoint cinematics (auto-discovered by
// Convex; no index.ts barrel needed — same as npcMedia / sceneMedia).
//
// `getSaveCinematics` returns the cinematic asset views for a save so the
// client can render the `CinematicMoment` surface (opening / ending) and the
// trophy crypt's inline playback. Per build-correction C5 cinematics are keyed
// to the SAVE, so this returns per-save rows — a repeat playthrough that
// reaches an already-unlocked ending still surfaces ITS OWN cinematic here.

import { v } from "convex/values";
import { queryGeneric } from "convex/server";

import { loadAndAuthorizeAccount } from "../lib/authz";
import { assertCanAccessSave, type SaveRecord } from "../saves";

const accountId = v.id("accounts");
const saveId = v.id("saves");

type CinematicAssetDoc = {
  _id: string;
  accountId: string;
  saveId?: string;
  sceneId?: string;
  kind: string;
  provider: string;
  url: string;
  status: "queued" | "generating" | "ready" | "failed" | "blocked";
  cinematicTrigger?: "opening" | "ending";
  endingId?: string;
  hasAudio?: boolean;
  alt?: string;
  provenance: Record<string, unknown>;
  durationMs?: number;
  createdAt: number;
  updatedAt?: number;
  readyAt?: number;
};

export type CinematicView = {
  assetId: string;
  status: "queued" | "generating" | "ready" | "failed" | "blocked";
  trigger: "opening" | "ending" | "chapter" | null;
  endingId: string | null;
  url: string | null;
  hasAudio: boolean;
  alt: string | null;
  // Poster/still fallback origin + provenance the UI surfaces (SynthID badge,
  // fallback pip). Redacted provenance only — never prompt text.
  fallbackKind: string | null;
  synthId: boolean;
  model: string | null;
  createdAt: number;
  readyAt: number | null;
};

function toView(doc: CinematicAssetDoc): CinematicView {
  const prov = doc.provenance ?? {};
  return {
    assetId: doc._id,
    status: doc.status,
    trigger: doc.cinematicTrigger ?? null,
    endingId: doc.endingId ?? null,
    url: doc.url && doc.url.length > 0 ? doc.url : null,
    hasAudio: doc.hasAudio === true,
    alt: doc.alt ?? null,
    fallbackKind: typeof prov.fallbackKind === "string" ? prov.fallbackKind : null,
    synthId: prov.synthId === true,
    model: typeof prov.model === "string" ? prov.model : null,
    createdAt: doc.createdAt,
    readyAt: doc.readyAt ?? null,
  };
}

function saveFromDoc(doc: Record<string, unknown>): SaveRecord {
  return doc as unknown as SaveRecord;
}

/**
 * All cinematics for a save (opening + endings), newest first. Auth: the caller
 * must own the save AND present a valid session (guest token or user identity)
 * — cinematics are Pro media whose URLs must not be enumerable across accounts.
 */
export const getSaveCinematics = queryGeneric({
  args: {
    accountId,
    saveId,
    guestTokenHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const saveDoc = await ctx.db.get(args.saveId);
    if (!saveDoc) return { cinematics: [] as CinematicView[] };
    const save = saveFromDoc(saveDoc);
    assertCanAccessSave(args.accountId, save);
    await loadAndAuthorizeAccount(ctx as any, args.accountId, args.guestTokenHash);

    const docs = (await ctx.db
      .query("assets")
      .withIndex("by_save_kind", (q: any) => q.eq("saveId", args.saveId).eq("kind", "cinematic"))
      .collect()) as CinematicAssetDoc[];

    const cinematics = docs
      .filter((d) => d.kind === "cinematic")
      .map(toView)
      .sort((a, b) => b.createdAt - a.createdAt);

    console.log(
      `[cinematicFunctions] getSaveCinematics save=${args.saveId} count=${cinematics.length} items=[${cinematics
        .map((c) => `${c.trigger}:${c.status}${c.url ? "" : ":nourl"}`)
        .join(",")}]`,
    );
    return { cinematics };
  },
});
