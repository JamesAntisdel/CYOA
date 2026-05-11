export type CheckoutMode = "web" | "native";
export type PaidPlanId = "unlimited" | "pro";

export const checkoutMode: CheckoutMode = process.env.EXPO_PUBLIC_STRIPE_CHECKOUT_MODE === "native" ? "native" : "web";
export const publicAppUrl = process.env.PUBLIC_APP_URL ?? "https://localhost";

export function checkoutUnavailableMessage(planId: PaidPlanId): string {
  if (checkoutMode === "native") {
    return `${planId} checkout is not available yet.`;
  }

  return `${planId} checkout is not available yet.`;
}
