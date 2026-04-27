import { mergeEntitlementUpdate, type EntitlementRecord } from "./entitlements";

export type NativeReceipt = {
  platform: "apple" | "google";
  accountId: string;
  productId: string;
  transactionId: string;
  expiresAt?: number;
  verified: boolean;
  verifiedAt: number;
};

export function normalizeNativeReceipt(
  existing: EntitlementRecord | null,
  receipt: NativeReceipt,
): EntitlementRecord {
  if (!receipt.verified) throw new Error("native_receipt_unverified");
  const tier = receipt.productId.includes("pro") ? "pro" : "unlimited";
  return mergeEntitlementUpdate(existing, {
    accountId: receipt.accountId,
    tier,
    source: receipt.platform,
    status: "active",
    ...(receipt.expiresAt === undefined ? {} : { renewsAt: receipt.expiresAt }),
    updatedAt: receipt.verifiedAt,
  });
}
