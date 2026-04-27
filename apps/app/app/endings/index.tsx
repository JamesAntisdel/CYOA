import { ScrollView, StyleSheet, Text, View } from "react-native";

import { EndingsMap, TrophyCrypt, type EndingNode } from "../../components/endings";

const endings: EndingNode[] = [
  { id: "escape", title: "The Door Opens", unlocked: true, pathHint: "Training Room / Dawn" },
  { id: "quiet-return", title: "The Quiet Return", unlocked: true, pathHint: "Training Room / Listen" },
  { id: "iron-risk", title: "Iron Lesson", unlocked: false },
  { id: "lantern-crypt", title: "Lantern Crypt", unlocked: false },
];

export default function EndingsRoute() {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Endings</Text>
        <Text style={styles.title}>Known paths and hidden doors.</Text>
        <Text style={styles.copy}>Hidden endings stay concealed until they are earned.</Text>
      </View>
      <EndingsMap nodes={endings} />
      <TrophyCrypt endings={endings} />
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
    maxWidth: 760,
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
    lineHeight: 22,
  },
});
