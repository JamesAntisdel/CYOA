// Fake-ctx tests for the media credit / spark economy (provider-and-credit-model
// design §2). Covers: the price card, spend debits + balance mirroring, refund
// idempotency, allowance-then-spark ordering, pack + Pro grant idempotency, the
// Unlimited fair-use cap boundary, and the Pro strategy-default flip.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MEDIA_SPARK_COSTS,
  SPARK_VALUE_CENTS,
  mediaSparkCost,
  sparksToCents,
} from "../billing/mediaCosts";
import {
  assertAndReserveSpark,
  balanceForAccount,
  chargeMediaSpend,
  grantProAllowance,
  ledgerSumForAccount,
  PRO_MONTHLY_SPARK_GRANT,
  recordPackPurchase,
  refundSpark,
} from "../billing/mediaCredits";
import { UNLIMITED_DAILY_SOFT_CAP, unlimitedTurnCapExceeded } from "../billing/fairUse";
import {
  buildCreditPackCheckoutParams,
  CREDIT_PACKS,
  packSparksFromSessionMetadata,
} from "../billing/stripe";
import { resolveMediaStrategy } from "../media/mediaStrategy";
import { makeDayKey } from "../lib/ids";

type AnyDoc = Record<string, any>;

// A ledger-aware fake ctx whose `withIndex` actually filters on the `.eq(...)`
// keys the helpers pass, so idempotency + balance behave for real.
function makeLedgerCtx(seed?: {
  entitlement?: AnyDoc | null;
  ledger?: AnyDoc[];
  assets?: Record<string, AnyDoc>;
  counters?: AnyDoc[];
}) {
  const ledger: AnyDoc[] = [...(seed?.ledger ?? [])];
  const entitlements: AnyDoc[] = seed?.entitlement ? [{ _id: "ent_1", ...seed.entitlement }] : [];
  const assets = seed?.assets ?? {};
  const counters: AnyDoc[] = seed?.counters ?? [];
  let nextId = 1;

  const ctx = {
    db: {
      async get(id: unknown) {
        return assets[String(id)] ?? entitlements.find((e) => e._id === id) ?? null;
      },
      query(table: string) {
        const rows: AnyDoc[] =
          table === "media_credits_ledger"
            ? ledger
            : table === "entitlements"
              ? entitlements
              : table === "daily_turn_counter"
                ? counters
                : [];
        return {
          withIndex(_name: string, build: (q: any) => any) {
            const filters: Record<string, unknown> = {};
            const q = {
              eq(field: string, value: unknown) {
                filters[field] = value;
                return q;
              },
            };
            build(q);
            const filtered = rows.filter((r) =>
              Object.entries(filters).every(([k, v]) => r[k] === v),
            );
            return {
              async first() {
                return filtered[0] ?? null;
              },
              async collect() {
                return filtered;
              },
            };
          },
        };
      },
      async insert(table: string, doc: AnyDoc) {
        const id = `${table}_${nextId++}`;
        const row = { _id: id, ...doc };
        if (table === "media_credits_ledger") ledger.push(row);
        return id;
      },
      async patch(id: unknown, patch: AnyDoc) {
        const ent = entitlements.find((e) => e._id === id);
        if (ent) Object.assign(ent, patch);
      },
    },
  };
  return { ctx, ledger, entitlements };
}

describe("media spark price card (design §2.1)", () => {
  it("prices each media product per the design table", () => {
    expect(MEDIA_SPARK_COSTS).toEqual({
      scene_still: 15,
      narration: 8,
      illustrated_narrated: 25,
      veo_clip: 60,
      omni_cinematic: 240,
    });
    expect(mediaSparkCost("veo_clip")).toBe(60);
    expect(SPARK_VALUE_CENTS).toBe(1);
    expect(sparksToCents(240)).toBe(240);
  });
});

describe("assertAndReserveSpark", () => {
  it("writes a reader_spend debit and mirrors the balance", async () => {
    const { ctx, ledger, entitlements } = makeLedgerCtx({
      entitlement: { accountId: "a", tier: "pro", status: "active" },
      ledger: [{ accountId: "a", delta: 100, reason: "pro_allowance", idempotencyKey: "g", createdAt: 1 }],
    });
    const res = await assertAndReserveSpark(ctx, "a", 15, "spend:asset1", "asset1");
    expect(res).toMatchObject({ sparks: 15, balanceAfter: 85, duplicate: false });
    const debit = ledger.find((r) => r.reason === "reader_spend");
    expect(debit).toMatchObject({ delta: -15, assetId: "asset1", accountId: "a" });
    expect(entitlements[0]!.creditBalanceCents).toBe(85);
  });

  it("writes a creator_spend debit when the spender is a creator", async () => {
    const { ctx, ledger } = makeLedgerCtx({
      ledger: [{ accountId: "a", delta: 100, reason: "pack_purchase", idempotencyKey: "g", createdAt: 1 }],
    });
    await assertAndReserveSpark(ctx, "a", 25, "spend:x", "x", "creator");
    expect(ledger.find((r) => r.reason === "creator_spend")).toMatchObject({ delta: -25 });
  });

  it("is idempotent on the idempotency key", async () => {
    const { ctx, ledger } = makeLedgerCtx({
      ledger: [{ accountId: "a", delta: 100, reason: "pro_allowance", idempotencyKey: "g", createdAt: 1 }],
    });
    await assertAndReserveSpark(ctx, "a", 15, "spend:dup", "d");
    const second = await assertAndReserveSpark(ctx, "a", 15, "spend:dup", "d");
    expect(second).toMatchObject({ sparks: 0, duplicate: true });
    expect(ledger.filter((r) => r.reason === "reader_spend")).toHaveLength(1);
  });

  it("throws insufficient_sparks when the balance can't cover the cost", async () => {
    const { ctx } = makeLedgerCtx({
      ledger: [{ accountId: "a", delta: 10, reason: "pro_allowance", idempotencyKey: "g", createdAt: 1 }],
    });
    await expect(assertAndReserveSpark(ctx, "a", 15, "spend:no", "no")).rejects.toThrow(
      "insufficient_sparks",
    );
  });

  it("no-ops for a zero-cost reservation", async () => {
    const { ctx, ledger } = makeLedgerCtx();
    const res = await assertAndReserveSpark(ctx, "a", 0, "spend:free", "free");
    expect(res).toMatchObject({ sparks: 0, duplicate: false });
    expect(ledger).toHaveLength(0);
  });
});

describe("refundSpark", () => {
  it("refunds exactly the spend and is idempotent", async () => {
    const { ctx, ledger } = makeLedgerCtx({
      entitlement: { accountId: "a", tier: "pro", status: "active" },
      ledger: [{ accountId: "a", delta: 100, reason: "pro_allowance", idempotencyKey: "g", createdAt: 1 }],
      assets: { asset1: { _id: "asset1", accountId: "a" } },
    });
    await assertAndReserveSpark(ctx, "a", 15, "spend:asset1", "asset1");
    const first = await refundSpark(ctx, "asset1");
    expect(first).toEqual({ refunded: true, sparks: 15 });
    expect(await ledgerSumForAccount(ctx, "a")).toBe(100);
    const second = await refundSpark(ctx, "asset1");
    expect(second).toEqual({ refunded: false, sparks: 0 });
    expect(ledger.filter((r) => r.reason === "refund")).toHaveLength(1);
  });

  it("refunds nothing for an un-charged asset (anchor / NPC base experience)", async () => {
    const { ctx } = makeLedgerCtx({ assets: { anchor: { _id: "anchor", accountId: "a" } } });
    expect(await refundSpark(ctx, "anchor")).toEqual({ refunded: false, sparks: 0 });
  });

  it("refunds nothing when the asset is missing", async () => {
    const { ctx } = makeLedgerCtx();
    expect(await refundSpark(ctx, "ghost")).toEqual({ refunded: false, sparks: 0 });
  });
});

describe("chargeMediaSpend (allowance-then-spark ordering)", () => {
  it("consumes the Pro image allowance FIRST, then charges sparks", async () => {
    const { ctx, entitlements } = makeLedgerCtx({
      entitlement: { accountId: "a", tier: "pro", status: "active", includedImages: 1 },
      ledger: [{ accountId: "a", delta: 100, reason: "pro_allowance", idempotencyKey: "g", createdAt: 1 }],
    });
    const first = await chargeMediaSpend(ctx, {
      accountId: "a",
      chargeKind: "image",
      sparkKind: "scene_still",
      assetId: "img1",
      idempotencyKey: "spend:img1",
    });
    expect(first).toEqual({ charged: true, via: "allowance", sparks: 0 });
    expect(entitlements[0]!.includedImages).toBe(0);

    const second = await chargeMediaSpend(ctx, {
      accountId: "a",
      chargeKind: "image",
      sparkKind: "scene_still",
      assetId: "img2",
      idempotencyKey: "spend:img2",
    });
    expect(second).toEqual({ charged: true, via: "spark", sparks: 15 });
  });

  it("charges sparks directly for narration/cinematic (no image/video allowance)", async () => {
    const { ctx } = makeLedgerCtx({
      entitlement: { accountId: "a", tier: "pro", status: "active", includedImages: 5 },
      ledger: [{ accountId: "a", delta: 300, reason: "pro_allowance", idempotencyKey: "g", createdAt: 1 }],
    });
    const cinematic = await chargeMediaSpend(ctx, {
      accountId: "a",
      chargeKind: "cinematic",
      sparkKind: "omni_cinematic",
      assetId: "cin1",
      idempotencyKey: "spend:cin1",
    });
    expect(cinematic).toEqual({ charged: true, via: "spark", sparks: 240 });
  });

  it("returns not-charged (no throw) when the balance is exhausted", async () => {
    const { ctx } = makeLedgerCtx({
      entitlement: { accountId: "a", tier: "pro", status: "active" },
      ledger: [],
    });
    const res = await chargeMediaSpend(ctx, {
      accountId: "a",
      chargeKind: "video",
      sparkKind: "veo_clip",
      assetId: "v1",
      idempotencyKey: "spend:v1",
    });
    expect(res).toEqual({ charged: false, reason: "insufficient_sparks" });
  });
});

describe("grants", () => {
  it("records a pack purchase idempotently by session id", async () => {
    const { ctx, ledger } = makeLedgerCtx({ entitlement: { accountId: "a", tier: "free", status: "active" } });
    const first = await recordPackPurchase(ctx, { accountId: "a", sparks: 1200, stripeSessionId: "cs_1" });
    expect(first).toMatchObject({ granted: true, sparks: 1200, balanceAfter: 1200 });
    const dup = await recordPackPurchase(ctx, { accountId: "a", sparks: 1200, stripeSessionId: "cs_1" });
    expect(dup.granted).toBe(false);
    expect(ledger.filter((r) => r.reason === "pack_purchase")).toHaveLength(1);
  });

  it("grants the Pro monthly allowance once per billing period", async () => {
    const { ctx, ledger } = makeLedgerCtx();
    await grantProAllowance(ctx, { accountId: "a", sparks: PRO_MONTHLY_SPARK_GRANT, periodStart: 100 });
    await grantProAllowance(ctx, { accountId: "a", sparks: PRO_MONTHLY_SPARK_GRANT, periodStart: 100 });
    await grantProAllowance(ctx, { accountId: "a", sparks: PRO_MONTHLY_SPARK_GRANT, periodStart: 200 });
    expect(ledger.filter((r) => r.reason === "pro_allowance")).toHaveLength(2);
    expect(PRO_MONTHLY_SPARK_GRANT).toBe(1200);
  });

  it("balanceForAccount sums the ledger and mirrors it", async () => {
    const { ctx, entitlements } = makeLedgerCtx({
      entitlement: { accountId: "a", tier: "pro", status: "active" },
      ledger: [
        { accountId: "a", delta: 1200, reason: "pro_allowance", idempotencyKey: "g", createdAt: 1 },
        { accountId: "a", delta: -60, reason: "reader_spend", idempotencyKey: "s", createdAt: 2 },
      ],
    });
    expect(await balanceForAccount(ctx, "a")).toBe(1140);
    expect(entitlements[0]!.creditBalanceCents).toBe(1140);
  });
});

describe("credit pack checkout (design §2.4)", () => {
  it("prices the three packs and builds a payment-mode session", () => {
    expect(CREDIT_PACKS.sparks_500).toMatchObject({ sparks: 500, priceCents: 499 });
    expect(CREDIT_PACKS.sparks_1200).toMatchObject({ sparks: 1200, priceCents: 999 });
    expect(CREDIT_PACKS.sparks_4000).toMatchObject({ sparks: 4000, priceCents: 2499 });
    const params = buildCreditPackCheckoutParams({
      accountId: "acct",
      packId: "sparks_1200",
      successUrl: "https://app/ok",
      cancelUrl: "https://app/no",
    });
    expect(params).toMatchObject({
      mode: "payment",
      client_reference_id: "acct",
      metadata: { accountId: "acct", packId: "sparks_1200", sparks: "1200" },
    });
    expect(params.line_items[0]!.price_data.unit_amount).toBe(999);
  });

  it("rejects non-https urls", () => {
    expect(() =>
      buildCreditPackCheckoutParams({
        accountId: "a",
        packId: "sparks_500",
        successUrl: "http://x",
        cancelUrl: "https://y",
      }),
    ).toThrow("checkout_urls_must_be_https");
  });

  it("resolves pack sparks from session metadata (and null for subscriptions)", () => {
    expect(packSparksFromSessionMetadata({ packId: "sparks_4000" })).toEqual({
      packId: "sparks_4000",
      sparks: 4000,
    });
    expect(packSparksFromSessionMetadata({ targetTier: "pro" })).toBeNull();
    expect(packSparksFromSessionMetadata(null)).toBeNull();
  });
});

describe("unlimitedTurnCapExceeded (design §2.4)", () => {
  const NOW = Date.UTC(2026, 6, 12, 12, 0, 0);
  const dayKey = makeDayKey(new Date(NOW));

  it("is false under the soft cap and true at/over it", async () => {
    expect(UNLIMITED_DAILY_SOFT_CAP).toBe(60);
    const under = makeLedgerCtx({ counters: [{ accountId: "a", dayKey, turnsUsed: 59 }] });
    expect(await unlimitedTurnCapExceeded(under.ctx, "a", NOW)).toBe(false);
    const at = makeLedgerCtx({ counters: [{ accountId: "a", dayKey, turnsUsed: 60 }] });
    expect(await unlimitedTurnCapExceeded(at.ctx, "a", NOW)).toBe(true);
  });

  it("is false when there is no counter for today", async () => {
    const { ctx } = makeLedgerCtx({ counters: [] });
    expect(await unlimitedTurnCapExceeded(ctx, "a", NOW)).toBe(false);
  });
});

describe("Pro media strategy default flip (design §2.4)", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "k";
    process.env.OMNI_ENABLED = "1";
    delete process.env.CYOA_DEV_FORCE_PRO_MEDIA;
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OMNI_ENABLED;
  });

  function strategyCtx(account: AnyDoc, entitlement: AnyDoc | null) {
    return {
      db: {
        async get() {
          return account;
        },
        query(_table: string) {
          return {
            withIndex() {
              return {
                async first() {
                  return entitlement;
                },
              };
            },
          };
        },
      },
    };
  }

  const account = {
    _id: "a",
    kind: "user",
    ageBand: "18+",
    matureContentEnabled: false,
    createdAt: 1,
    lastActiveAt: 1,
    mediaPrefs: { imagesEnabled: true, audioEnabled: true, videoEnabled: true },
  };

  it("defaults an active Pro account (no explicit mode) to endpoint_cinematic", async () => {
    const ctx = strategyCtx(account, { accountId: "a", tier: "pro", status: "active" });
    expect(await resolveMediaStrategy(ctx as any, "a")).toBe("endpoint_cinematic");
  });

  it("keeps per_scene_legacy for a non-paid account", async () => {
    const ctx = strategyCtx(account, { accountId: "a", tier: "free", status: "active" });
    expect(await resolveMediaStrategy(ctx as any, "a")).toBe("per_scene_legacy");
  });
});
