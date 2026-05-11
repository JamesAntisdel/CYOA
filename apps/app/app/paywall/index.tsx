import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppNav } from "../../components/navigation";
import { PaywallPanel, type PaywallPlan } from "../../components/paywall";
import { checkoutUnavailableMessage, publicAppUrl } from "../../lib/billingConfig";
import { useGuestSession } from "../../hooks/useGuestSession";
import { createRemoteCheckoutSession, previewRemotePlan } from "../../lib/gameApi";

export default function PaywallRoute() {
  const guest = useGuestSession();
  const [overageEnabled, setOverageEnabled] = useState(false);
  const [spendCapCents, setSpendCapCents] = useState(1000);
  const [preview, setPreview] = useState("Select a plan to preview server-confirmed pricing.");

  const selectPlan = async (planId: PaywallPlan["id"]) => {
    const accountId = guest.session?.accountId;
    const previewResult = await previewRemotePlan({
      currentTier: "free",
      targetTier: planId,
    });
    if (previewResult) {
      setPreview(
        `Due now: $${(previewResult.immediateChargeCents / 100).toFixed(2)}. Credit applied: $${(previewResult.creditAppliedCents / 100).toFixed(2)}.`,
      );
    } else {
      setPreview(checkoutUnavailableMessage(planId));
    }

    if (!accountId) return;
    const checkout = await createRemoteCheckoutSession({
      accountId,
      targetTier: planId,
      interval: "monthly",
      successUrl: `${publicAppUrl}/paywall/success`,
      cancelUrl: `${publicAppUrl}/paywall`,
    });
    if (checkout) setPreview(`Checkout ready: ${checkout.url}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <AppNav />
      <PaywallPanel
        onSelectPlan={selectPlan}
        onSpendCapChange={setSpendCapCents}
        onToggleOverage={() => setOverageEnabled((current) => !current)}
        overageEnabled={overageEnabled}
        reason="daily_limit"
        spendCapCents={spendCapCents}
      />
      <View style={styles.preview}>
        <Text style={styles.previewTitle}>Plan preview</Text>
        <Text style={styles.previewCopy}>{preview}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#efe2c8",
    flexGrow: 1,
    gap: 18,
    padding: 18,
  },
  preview: {
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  previewTitle: {
    color: "#24180f",
    fontSize: 18,
    fontWeight: "800",
  },
  previewCopy: {
    color: "#594635",
    fontSize: 15,
    lineHeight: 22,
  },
});
