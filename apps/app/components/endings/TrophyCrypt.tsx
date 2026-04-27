import { StyleSheet, Text, View } from "react-native";

import type { EndingNode } from "./EndingsMap";

type TrophyCryptProps = {
  endings: EndingNode[];
};

export function TrophyCrypt({ endings }: TrophyCryptProps) {
  const unlockedCount = endings.filter((ending) => ending.unlocked).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.summary}>
        <Text style={styles.title}>Trophy crypt</Text>
        <Text style={styles.copy}>
          {unlockedCount} of {endings.length} endings found
        </Text>
      </View>
      <View style={styles.grid}>
        {endings.map((ending) => (
          <View key={ending.id} style={[styles.trophy, ending.unlocked && styles.trophyUnlocked]}>
            <Text style={styles.trophyMark}>{ending.unlocked ? "◆" : "◇"}</Text>
            <Text style={styles.trophyText}>{ending.unlocked ? ending.title : "Locked"}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  summary: {
    gap: 4,
  },
  title: {
    color: "#24180f",
    fontSize: 22,
    fontWeight: "800",
  },
  copy: {
    color: "#594635",
    fontSize: 15,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  trophy: {
    alignItems: "center",
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderWidth: 1,
    gap: 6,
    minHeight: 88,
    padding: 12,
    width: 132,
  },
  trophyUnlocked: {
    backgroundColor: "#f1dfbc",
    borderColor: "#7b5a35",
  },
  trophyMark: {
    color: "#7b3f20",
    fontSize: 22,
  },
  trophyText: {
    color: "#24180f",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
