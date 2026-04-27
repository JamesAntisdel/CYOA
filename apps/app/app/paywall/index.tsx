import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { PaywallPanel, type PaywallPlan } from "../../components/paywall";

export default function PaywallRoute() {
  const [overageEnabled, setOverageEnabled] = useState(false);
  const [spendCapCents, setSpendCapCents] = useState(1000);
  const [preview, setPreview] = useState("Select a plan to preview server-confirmed pricing.");

  const selectPlan = (planId: PaywallPlan["id"]) => {
    setPreview(
      planId === "pro"
        ? "Pro preview: $25/mo before credits. Media jobs remain async and safety-gated."
        : "Unlimited preview: $10/mo before credits. General turns become unlimited after Stripe confirmation.",
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
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
