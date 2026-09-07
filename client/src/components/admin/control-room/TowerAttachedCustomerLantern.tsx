import {
  clusterLanternState,
  lanternAssetForClusterState,
} from "./lanternCustomerPresentation";
import {
  lanternDensityClass,
  type CustomerLocationCluster,
} from "./customerGeography";

export function TowerAttachedCustomerLantern({
  cluster,
}: {
  cluster: CustomerLocationCluster;
}) {
  const state = clusterLanternState(cluster);
  const art = lanternAssetForClusterState(state);
  return (
    <span
      className={`lc-tower-attached-lantern ${lanternDensityClass(cluster.total)} state-${state}`}
      aria-hidden
    >
      <img className="lc-tower-attached-lantern-art" src={art} alt="" />
      {cluster.total > 1 ? (
        <b className="lc-tower-attached-lantern-count">{cluster.total}</b>
      ) : null}
    </span>
  );
}
