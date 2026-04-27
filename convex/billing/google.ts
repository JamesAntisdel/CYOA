import type { NativeReceipt } from "./nativeReceipts";

export function verifyGoogleReceipt(receipt: Omit<NativeReceipt, "platform" | "verified">): NativeReceipt {
  return { ...receipt, platform: "google", verified: receipt.transactionId.length > 0 };
}
