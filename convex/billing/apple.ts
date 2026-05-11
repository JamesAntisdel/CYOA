import type { NativeReceipt } from "./nativeReceipts";
import { AppError } from "../lib/errors";

export type AppleTransactionRecord = {
  transactionId: string;
  originalTransactionId?: string;
  productId: string;
  appAccountToken?: string;
  bundleId?: string;
  expiresAt?: number;
  revokedAt?: number;
};

export type AppleReceiptVerifier = {
  expectedBundleId?: string;
  fetchTransaction: (transactionId: string) => Promise<AppleTransactionRecord>;
};

export async function verifyAppleReceipt(
  receipt: Omit<NativeReceipt, "platform" | "verified">,
  verifier: AppleReceiptVerifier = appleReceiptVerifierFromEnv(),
): Promise<NativeReceipt> {
  if (receipt.transactionId.length === 0) throw new AppError("native_receipt_transaction_required");
  const transaction = await verifier.fetchTransaction(receipt.transactionId);
  if (transaction.transactionId !== receipt.transactionId && transaction.originalTransactionId !== receipt.transactionId) {
    throw new AppError("native_receipt_transaction_mismatch");
  }
  if (transaction.productId !== receipt.productId) throw new AppError("native_receipt_product_mismatch");
  if (verifier.expectedBundleId && transaction.bundleId !== verifier.expectedBundleId) {
    throw new AppError("native_receipt_bundle_mismatch");
  }
  if (transaction.appAccountToken && transaction.appAccountToken !== receipt.accountId) {
    throw new AppError("native_receipt_account_mismatch");
  }
  const now = receipt.verifiedAt;
  if (transaction.revokedAt && transaction.revokedAt <= now) throw new AppError("native_receipt_revoked");
  if (transaction.expiresAt && transaction.expiresAt <= now) throw new AppError("native_receipt_expired");

  const verified: NativeReceipt = {
    ...receipt,
    platform: "apple",
    verified: true,
    ...(transaction.expiresAt ?? receipt.expiresAt ? { expiresAt: transaction.expiresAt ?? receipt.expiresAt } : {}),
  };
  return verified;
}

export function appleReceiptVerifierFromEnv(
  env: Record<string, string | undefined> = process.env,
): AppleReceiptVerifier {
  const bearerToken = requireEnv(env, "APP_STORE_CONNECT_BEARER_TOKEN");
  return {
    ...(env.APPLE_BUNDLE_ID ? { expectedBundleId: env.APPLE_BUNDLE_ID } : {}),
    fetchTransaction: async (transactionId) => {
      const response = await fetch(`https://api.storekit.itunes.apple.com/inApps/v1/transactions/${transactionId}`, {
        headers: { authorization: `Bearer ${bearerToken}` },
      });
      if (!response.ok) throw new AppError(`apple_receipt_lookup_failed:${response.status}`);
      const payload = await response.json() as {
        transactionId?: string;
        originalTransactionId?: string;
        productId?: string;
        appAccountToken?: string;
        bundleId?: string;
        expiresDate?: number | string;
        revocationDate?: number | string;
      };
      return {
        transactionId: requireString(payload.transactionId, "apple_transaction_id_missing"),
        ...(payload.originalTransactionId ? { originalTransactionId: payload.originalTransactionId } : {}),
        productId: requireString(payload.productId, "apple_product_id_missing"),
        ...(payload.appAccountToken ? { appAccountToken: payload.appAccountToken } : {}),
        ...(payload.bundleId ? { bundleId: payload.bundleId } : {}),
        ...(payload.expiresDate ? { expiresAt: Number(payload.expiresDate) } : {}),
        ...(payload.revocationDate ? { revokedAt: Number(payload.revocationDate) } : {}),
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
