import { PropsWithChildren } from "react";
import { View } from "react-native";

import { useAppTheme } from "../../theme";
import { Stamp, Surface, Text } from "../primitives";
import type { AdminAccount } from "./types";

type AdminGateProps = PropsWithChildren<{
  account: AdminAccount | null;
}>;

export function AdminGate({ account, children }: AdminGateProps) {
  const { tokens } = useAppTheme();

  if (account?.isAdmin === true) {
    return <>{children}</>;
  }

  return (
    <View style={{ gap: tokens.spacing.md }}>
      <Stamp>admin</Stamp>
      <Surface padded variant="muted">
        <View style={{ gap: tokens.spacing.sm }}>
          <Text variant="subtitle">Admin claim required</Text>
          <Text muted>
            Operator dashboards are hidden until the signed-in account has an admin claim.
          </Text>
        </View>
      </Surface>
    </View>
  );
}
