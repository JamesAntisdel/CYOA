import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AgeGate } from "../../components/account/AgeGate";
import { AppNav } from "../../components/navigation";
import { useAuthSession } from "../../hooks/useAuthSession";
import { useGuestSession, type AgeSelection } from "../../hooks/useGuestSession";

type AuthMode = "sign-in" | "sign-up";

export default function LoginRoute() {
  const auth = useAuthSession();
  const guest = useGuestSession();
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAgeSubmit = (selection: AgeSelection) => {
    void guest.createGuestSession(selection);
  };

  const submit = async () => {
    setError(null);
    try {
      if (mode === "sign-up") {
        await auth.signUp({
          email,
          ...(guest.session ? { ageBand: guest.session.ageBand } : {}),
          ...(name.trim() ? { name } : {}),
          password,
        });
      } else {
        await auth.signIn({ email, password });
      }
      router.push("/account");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "auth_failed");
    }
  };

  if (!guest.session) {
    return (
      <ScrollView contentContainerStyle={styles.gatePage}>
        <AgeGate
          blockedMessage={guest.blocked ? guest.error : null}
          onSubmit={handleAgeSubmit}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <AppNav current="login" />
      <View style={styles.header}>
        <Text style={styles.kicker}>Account access</Text>
        <Text style={styles.title}>{mode === "sign-up" ? "Create account" : "Sign in"}</Text>
        <Text style={styles.copy}>Save your stories, continue on another device, and keep your created adventures with you.</Text>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === "sign-in" }}
          onPress={() => setMode("sign-in")}
          style={[styles.tab, mode === "sign-in" && styles.tabSelected]}
        >
          <Text style={[styles.tabText, mode === "sign-in" && styles.tabTextSelected]}>Sign in</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === "sign-up" }}
          onPress={() => setMode("sign-up")}
          style={[styles.tab, mode === "sign-up" && styles.tabSelected]}
        >
          <Text style={[styles.tabText, mode === "sign-up" && styles.tabTextSelected]}>Create</Text>
        </Pressable>
      </View>

      <View style={styles.form}>
        {mode === "sign-up" ? (
          <View style={styles.field}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              accessibilityLabel="Display name"
              onChangeText={setName}
              placeholder="Reader"
              style={styles.input}
              value={name}
            />
          </View>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            accessibilityLabel="Login email"
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="reader@example.com"
            style={styles.input}
            value={email}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            accessibilityLabel="Login password"
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable accessibilityRole="button" onPress={() => void submit()} style={styles.primaryButton}>
          <Text style={styles.primaryText}>{mode === "sign-up" ? "Create account" : "Sign in"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  gatePage: {
    alignItems: "center",
    backgroundColor: "#efe2c8",
    flexGrow: 1,
    justifyContent: "center",
    padding: 18,
  },
  page: {
    backgroundColor: "#efe2c8",
    flexGrow: 1,
    gap: 18,
    padding: 18,
  },
  header: {
    gap: 8,
    maxWidth: 620,
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
  tabs: {
    borderColor: "#7b5a35",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    maxWidth: 360,
  },
  tab: {
    alignItems: "center",
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  tabSelected: {
    backgroundColor: "#2d1d12",
  },
  tabText: {
    color: "#2d1d12",
    fontSize: 14,
    fontWeight: "800",
  },
  tabTextSelected: {
    color: "#fff8ea",
  },
  form: {
    borderColor: "#d5b98f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    maxWidth: 620,
    padding: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    color: "#594635",
    fontSize: 13,
    fontWeight: "800",
  },
  input: {
    backgroundColor: "#fff8ea",
    borderColor: "#7b5a35",
    borderRadius: 8,
    borderWidth: 1,
    color: "#24180f",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  errorText: {
    color: "#8f1d18",
    fontSize: 13,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2d1d12",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: "#fff8ea",
    fontSize: 15,
    fontWeight: "800",
  },
});
