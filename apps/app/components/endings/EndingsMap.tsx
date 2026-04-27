import { StyleSheet, Text, View } from "react-native";

export type EndingNode = {
  id: string;
  title: string;
  unlocked: boolean;
  pathHint?: string;
};

type EndingsMapProps = {
  nodes: EndingNode[];
};

export function EndingsMap({ nodes }: EndingsMapProps) {
  return (
    <View accessibilityLabel="Endings map" style={styles.map}>
      {nodes.map((node, index) => (
        <View key={node.id} style={[styles.node, node.unlocked && styles.nodeUnlocked]}>
          <Text style={styles.nodeStep}>{String(index + 1).padStart(2, "0")}</Text>
          <Text style={styles.nodeTitle}>{node.unlocked ? node.title : "Hidden ending"}</Text>
          <Text style={styles.nodeHint}>
            {node.unlocked ? (node.pathHint ?? "Path recorded") : "Undiscovered path"}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    gap: 10,
  },
  node: {
    backgroundColor: "#fff8ea",
    borderColor: "#d5b98f",
    borderStyle: "dashed",
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  nodeUnlocked: {
    borderColor: "#7b5a35",
    borderStyle: "solid",
  },
  nodeStep: {
    color: "#7b5a35",
    fontSize: 12,
    fontWeight: "800",
  },
  nodeTitle: {
    color: "#24180f",
    fontSize: 17,
    fontWeight: "800",
  },
  nodeHint: {
    color: "#594635",
    fontSize: 14,
  },
});
