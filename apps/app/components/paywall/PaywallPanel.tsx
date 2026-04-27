import { Pressable, StyleSheet, Text, View } from "react-native";

export type PaywallPlan = {
  id: "unlimited" | "pro";
  title: string;
  price: string;
  features: string[];
};

type PaywallPanelProps = {
  reason: "daily_limit" | "pro_media" | "credits";
  overageEnabled: boolean;
  spendCapCents: number;
  onToggleOverage: () => void;
  onSpendCapChange: (cents: number) => void;
  onSelectPlan: (planId: PaywallPlan["id"]) => void;
};

const plans: PaywallPlan[] = [
  {
    id: "unlimited",
    title: "Unlimited",
    price: "$10/mo",
    features: ["Unlimited general turns", "Longer memory window", "Stripe subscription controls"],
  },
  {
    id: "pro",
    title: "Pro",
    price: "$25/mo",
    features: ["Premium media queues", "Higher model budgets", "Credit and overage controls"],
  },
];

export function PaywallPanel({
  reason,
  overageEnabled,
  spendCapCents,
  onToggleOverage,
  onSpendCapChange,
  onSelectPlan,
}: PaywallPanelProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.kicker}>{reasonLabel(reason)}</Text>
        <Text style={styles.title}>Choose how the story keeps going.</Text>
        <Text style={styles.copy}>
          Upgrades and overages require server confirmation before access changes.
        </Text>
      </View>

      <View style={styles.planGrid}>
        {plans.map((plan) => (
          <View key={plan.id} style={styles.plan}>
            <Text style={styles.planTitle}>{plan.title}</Text>
            <Text style={styles.price}>{plan.price}</Text>
            {plan.features.map((feature) => (
              <Text key={feature} style={styles.feature}>
                {feature}
              </Text>
            ))}
            <Pressable accessibilityRole="button" onPress={() => onSelectPlan(plan.id)} style={styles.primaryButton}>
              <Text style={styles.primaryText}>Preview {plan.title}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.overageBox}>
        <View style={styles.overageHeader}>
          <Text style={styles.sectionTitle}>Overage control</Text>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: overageEnabled }} onPress={onToggleOverage}>
            <Text style={styles.textButton}>{overageEnabled ? "On" : "Off"}</Text>
          </Pressable>
        </View>
        <Text style={styles.copy}>
          Overage stays off until you set a monthly cap. Charges stop when the cap is reached.
        </Text>
        <View style={styles.capRow}>
          {[500, 1000, 2500].map((cap) => (
            <Pressable
              accessibilityRole="button"
              key={cap}
              onPress={() => onSpendCapChange(cap)}
              style={[styles.capButton, spendCapCents === cap && styles.capButtonSelected]}
            >
              <Text style={styles.capText}>${cap / 100}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function reasonLabel(reason: PaywallPanelProps["reason"]): string {
  if (reason === "pro_media") return "Pro media";
  if (reason === "credits") return "Credits";
  return "Daily limit";
}

const styles = StyleSheet.create({
  wrap: {
    gap: 18,
  },
  header: {
    gap: 8,
  },
  kicker: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#24180f",
    fontSize: 28,
    fontWeight: "800",
  },
  copy: {
    color: "#594635",
    fontSize: 15,
    lineHeight: 22,
  },
  planGrid: {
    gap: 12,
  },
  plan: {
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  planTitle: {
    color: "#24180f",
    fontSize: 22,
    fontWeight: "800",
  },
  price: {
    color: "#7b3f20",
    fontSize: 18,
    fontWeight: "800",
  },
  feature: {
    color: "#594635",
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2d1d12",
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: "#fff8ea",
    fontSize: 15,
    fontWeight: "800",
  },
  overageBox: {
    backgroundColor: "#f6e8c9",
    borderColor: "#d5b98f",
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  overageHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#24180f",
    fontSize: 18,
    fontWeight: "800",
  },
  textButton: {
    color: "#7b3f20",
    fontSize: 15,
    fontWeight: "800",
  },
  capRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  capButton: {
    borderColor: "#7b5a35",
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  capButtonSelected: {
    backgroundColor: "#ead9b6",
  },
  capText: {
    color: "#24180f",
    fontWeight: "800",
  },
});
