import type { NativeReceipt } from "./nativeReceipts";
import { AppError } from "../lib/errors";

export type GoogleSubscriptionRecord = {
  purchaseToken: string;
  productId: string;
  linkedAccountId?: string;
  packageName?: string;
  expiresAt?: number;
  acknowledgementState?: "ACKNOWLEDGED" | "PENDING" | string;
  subscriptionState?: "SUBSCRIPTION_STATE_ACTIVE" | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" | string;
};

export type GoogleReceiptVerifier = {
  packageName?: string;
  fetchSubscription: (receipt: Omit<NativeReceipt, "platform" | "verified">) => Promise<GoogleSubscriptionRecord>;
};

export async function verifyGoogleReceipt(
  receipt: Omit<NativeReceipt, "platform" | "verified">,
  verifier: GoogleReceiptVerifier = googleReceiptVerifierFromEnv(),
): Promise<NativeReceipt> {
  if (receipt.transactionId.length === 0) throw new AppError("native_receipt_transaction_required");
  const subscription = await verifier.fetchSubscription(receipt);
  if (subscription.purchaseToken !== receipt.transactionId) throw new AppError("native_receipt_transaction_mismatch");
  if (subscription.productId !== receipt.productId) throw new AppError("native_receipt_product_mismatch");
  if (verifier.packageName && subscription.packageName && subscription.packageName !== verifier.packageName) {
    throw new AppError("native_receipt_package_mismatch");
  }
  if (subscription.linkedAccountId && subscription.linkedAccountId !== receipt.accountId) {
    throw new AppError("native_receipt_account_mismatch");
  }
  if (subscription.acknowledgementState && subscription.acknowledgementState !== "ACKNOWLEDGED") {
    throw new AppError("native_receipt_not_acknowledged");
  }
  if (
    subscription.subscriptionState &&
    subscription.subscriptionState !== "SUBSCRIPTION_STATE_ACTIVE" &&
    subscription.subscriptionState !== "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  ) {
    throw new AppError("native_receipt_inactive");
  }
  if (subscription.expiresAt && subscription.expiresAt <= receipt.verifiedAt) throw new AppError("native_receipt_expired");

  const verified: NativeReceipt = {
    ...receipt,
    platform: "google",
    verified: true,
    ...(subscription.expiresAt ?? receipt.expiresAt ? { expiresAt: subscription.expiresAt ?? receipt.expiresAt } : {}),
  };
  return verified;
}

export function googleReceiptVerifierFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleReceiptVerifier {
  const accessToken = requireEnv(env, "GOOGLE_PLAY_ACCESS_TOKEN");
  const packageName = requireEnv(env, "GOOGLE_PLAY_PACKAGE_NAME");
  return {
    packageName,
    fetchSubscription: async (receipt) => {
      const response = await fetch(
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${receipt.transactionId}`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) throw new AppError(`google_receipt_lookup_failed:${response.status}`);
      const payload = await response.json() as {
        packageName?: string;
        lineItems?: Array<{
          productId?: string;
          expiryTime?: string;
        }>;
        linkedPurchaseToken?: string;
        externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
        acknowledgementState?: string;
        subscriptionState?: string;
      };
      const lineItem = payload.lineItems?.find((item) => item.productId === receipt.productId) ?? payload.lineItems?.[0];
      return {
        purchaseToken: receipt.transactionId,
        productId: requireString(lineItem?.productId, "google_product_id_missing"),
        ...(payload.packageName ? { packageName: payload.packageName } : {}),
        ...(payload.externalAccountIdentifiers?.obfuscatedExternalAccountId
          ? { linkedAccountId: payload.externalAccountIdentifiers.obfuscatedExternalAccountId }
          : {}),
        ...(lineItem?.expiryTime ? { expiresAt: Date.parse(lineItem.expiryTime) } : {}),
        ...(payload.acknowledgementState ? { acknowledgementState: payload.acknowledgementState } : {}),
        ...(payload.subscriptionState ? { subscriptionState: payload.subscriptionState } : {}),
      };
    },
  };
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value || value.trim().length === 0) throw new AppError(`missing_env:${key}`);
  return value;
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new AppError(error);
  return value;
}
