import { AdminDashboardScreen } from "../../../components/admin";
import { useAdminAnalytics } from "../../../hooks/useAdminAnalytics";

export default function AdminStoriesRoute() {
  const { account, dashboard } = useAdminAnalytics();

  return <AdminDashboardScreen account={account} dashboard={dashboard} view="stories" />;
}
