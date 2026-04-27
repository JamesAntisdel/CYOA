import type { NativeReceipt } from "./nativeReceipts";

export function verifyAppleReceipt(receipt: Omit<NativeReceipt, "platform" | "verified">): NativeReceipt {
  return { ...receipt, platform: "apple", verified: receipt.transactionId.length > 0 };
}
