import { useLocalSearchParams } from "expo-router";

import { ReaderScreen } from "../../../components/reading/ReaderScreen";

export default function ReadRoute() {
  const params = useLocalSearchParams<{ saveId?: string }>();
  const saveId = typeof params.saveId === "string" ? params.saveId : "training-room-demo";

  return <ReaderScreen saveId={saveId} />;
}
