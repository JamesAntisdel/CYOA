import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { EndingsMap, type EndingNode } from "../../../components/endings";

const pathNodes: EndingNode[] = [
  { id: "threshold", title: "Threshold", unlocked: true, pathHint: "First room visited" },
  { id: "blue-door", title: "Blue Door", unlocked: true, pathHint: "Listened before opening" },
  { id: "iron-door", title: "Iron Door", unlocked: false },
  { id: "escape", title: "The Door Opens", unlocked: true, pathHint: "Dawn dial path" },
];

export default function SaveMapRoute() {
  const params = useLocalSearchParams<{ saveId?: string }>();
  const saveId = typeof params.saveId === "string" ? params.saveId : "current";

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Path map</Text>
        <Text style={styles.title}>Save {saveId}</Text>
        <Text style={styles.copy}>Only visited nodes and earned endings are named.</Text>
      </View>
      <EndingsMap nodes={pathNodes} />
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
    fontSize: 30,
    fontWeight: "800",
  },
  copy: {
    color: "#594635",
    fontSize: 15,
  },
});
