import { useState } from "react";
import { Pressable, View } from "react-native";

import { useAppTheme } from "../../../theme";
import { Button, Divider, Field, Stamp, Surface, Text } from "../../primitives";
import {
  useAdminUserDetail,
  useAdminUsers,
} from "../../../hooks/useAdminContent";
import { grantAdminByEmail, type AdminUserListItem } from "../../../lib/adminApi";
import { guestAuthArgs, useGuestSession } from "../../../hooks/useGuestSession";
import { BoardHeader, MetricTile, RuledRow, TileGrid, formatCount } from "./internals";
import { StateGate } from "./Stories";

/**
 * Users board (product.md operator intent, Req 27). Three stacked panels:
 *   1. grant-admin — bootstrap/grant an admin claim by email
 *      (`account:devGrantAdmin`), authorized server-side by the
 *      CYOA_DEV_ALLOW_ADMIN_GRANT env or an existing admin caller.
 *   2. users list — accounts newest-first (`adminContent:listUsers`), each
 *      drilling into per-user detail (`adminContent:getUserDetail`) with an
 *      inline admin toggle (`account:promoteUser`).
 * Read-only apart from the two explicit admin mutations.
 */
export function UsersBoard() {
  return (
    <View style={{ gap: 16 }}>
      <GrantAdminPanel />
      <UsersListPanel />
    </View>
  );
}

function GrantAdminPanel() {
  const guest = useGuestSession();
  const accountId = guest.session?.accountId ?? null;
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!accountId || email.trim().length === 0) return;
    setPending(true);
    setResult(null);
    const granted = await grantAdminByEmail({
      email: email.trim(),
      callerAccountId: accountId,
      ...guestAuthArgs(),
    });
    setPending(false);
    if (granted) {
      setResult({ ok: true, message: `Granted admin to ${granted.email}.` });
      setEmail("");
    } else {
      setResult({
        ok: false,
        message: "Grant refused — no matching user, or you’re not authorized.",
      });
    }
  };

  return (
    <Surface padded>
      <View style={{ gap: 12 }}>
        <BoardHeader
          kicker="users · grant"
          sub="Grant an admin claim to a signed-up user by email. First-admin bootstrap uses the CYOA_DEV_ALLOW_ADMIN_GRANT env."
          title="Grant admin"
        />
        <Field
          autoCapitalize="none"
          keyboardType="email-address"
          label="User email"
          onChangeText={setEmail}
          placeholder="reader@example.com"
          testID="admin-grant-email"
          value={email}
        />
        <Button
          disabled={pending || email.trim().length === 0}
          onPress={submit}
          testID="admin-grant-submit"
          variant="primary"
        >
          {pending ? "Granting…" : "Grant admin"}
        </Button>
        {result ? (
          <Text muted={!result.ok} variant="bodySmall">
            {result.message}
          </Text>
        ) : null}
      </View>
    </Surface>
  );
}

function UsersListPanel() {
  const { status, items, isDone, loadingMore, loadMore, reload, promote } = useAdminUsers();
  const [selected, setSelected] = useState<string | null>(null);
  const adminCount = items.filter((u) => u.isAdmin).length;
  const userCount = items.filter((u) => u.kind === "user").length;

  return (
    <Surface padded>
      <View style={{ gap: 16 }}>
        <BoardHeader
          kicker="users · accounts"
          sub="Newest first. Tap a row to inspect saves; toggle admin inline."
          title="Users"
        />
        <StateGate status={status} onRetry={reload} emptyLabel="No accounts yet.">
          <View style={{ gap: 12 }}>
            <TileGrid testID="admin-users-tiles">
              <MetricTile label="Loaded" sub="accounts" value={formatCount(items.length)} />
              <MetricTile label="Signed up" sub="user accounts" value={formatCount(userCount)} />
              <MetricTile label="Admins" sub="in this page" value={String(adminCount)} />
            </TileGrid>
            <View style={{ gap: 8 }}>
              {items.map((user) => (
                <UserRow
                  key={user.accountId}
                  user={user}
                  selected={selected === user.accountId}
                  onToggle={() =>
                    setSelected((current) =>
                      current === user.accountId ? null : user.accountId,
                    )
                  }
                  onPromote={(next) => promote(user.accountId, next)}
                />
              ))}
              {!isDone ? (
                <Button
                  disabled={loadingMore}
                  onPress={loadMore}
                  testID="admin-users-more"
                  variant="ghost"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </View>
          </View>
        </StateGate>
      </View>
    </Surface>
  );
}

function UserRow({
  user,
  selected,
  onToggle,
  onPromote,
}: {
  user: AdminUserListItem;
  selected: boolean;
  onToggle: () => void;
  onPromote: (next: boolean) => Promise<boolean>;
}) {
  const { tokens } = useAppTheme();
  const [pending, setPending] = useState(false);

  const togglePromote = async () => {
    setPending(true);
    await onPromote(!user.isAdmin);
    setPending(false);
  };

  return (
    <View style={{ gap: tokens.spacing.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Account ${user.accountId}`}
        onPress={onToggle}
      >
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: tokens.spacing.md,
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontStyle: "italic" }} variant="bodySmall">
              {user.email ?? `${user.kind} · ${user.accountId}`}
            </Text>
          </View>
          {user.isAdmin ? <Stamp>admin</Stamp> : null}
        </View>
      </Pressable>
      <RuledRow
        label={`${user.kind} · ${user.tier}`}
        value={`${formatCount(user.saveCount)} saves`}
      />
      {selected ? (
        <View style={{ gap: 8 }}>
          <UserDetailPanel targetAccountId={user.accountId} />
          {user.kind === "user" ? (
            <Button
              disabled={pending}
              onPress={togglePromote}
              testID={`admin-user-promote-${user.accountId}`}
              variant={user.isAdmin ? "danger" : "secondary"}
            >
              {pending ? "Saving…" : user.isAdmin ? "Revoke admin" : "Make admin"}
            </Button>
          ) : (
            <Text muted variant="caption">Only signed-up users can be admins.</Text>
          )}
        </View>
      ) : null}
      <Divider />
    </View>
  );
}

function UserDetailPanel({ targetAccountId }: { targetAccountId: string }) {
  const { detail, status } = useAdminUserDetail(targetAccountId);

  if (status === "loading") {
    return <Text muted variant="caption">Loading account…</Text>;
  }
  if (status !== "ready" || !detail) {
    return <Text muted variant="caption">Account detail unavailable.</Text>;
  }

  return (
    <Surface padded variant="muted">
      <View style={{ gap: 8 }}>
        <RuledRow label="Age band" value={detail.ageBand || "—"} />
        <RuledRow
          label="Entitlement"
          value={`${detail.tier}${detail.entitlementStatus ? ` · ${detail.entitlementStatus}` : ""}`}
        />
        <RuledRow label="Saves" value={formatCount(detail.saveCount)} />
        <RuledRow
          label="Joined"
          value={detail.createdAt ? new Date(detail.createdAt).toLocaleDateString() : "—"}
        />
        {detail.saves.slice(0, 8).map((save) => (
          <RuledRow
            key={save.saveId}
            label={save.storyId || "(untitled)"}
            value={`t${save.turnNumber} · ${save.status}`}
          />
        ))}
      </View>
    </Surface>
  );
}
