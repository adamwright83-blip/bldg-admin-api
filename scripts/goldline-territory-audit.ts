import { getGeographicTruth } from "../server/geography/geographicTruthService";
import { deriveTerritoryOccupancy } from "../shared/lanternTerritories";

const tenantId =
  process.argv.find(value => value.startsWith("--tenant="))?.slice(9) ||
  "default";
const truth = await getGeographicTruth({ tenantId });
const customerLocations = truth.customers.flatMap(customer =>
  customer.location
    ? [
        {
          latitude: customer.location.latitude,
          longitude: customer.location.longitude,
        },
      ]
    : []
);
const occupancy = deriveTerritoryOccupancy({
  customers: customerLocations,
  totalCustomers: truth.customers.length,
  atlasReady: true,
});

console.log(
  JSON.stringify(
    {
      tenantId,
      customers: truth.customers.length,
      mappedCustomers: customerLocations.length,
      unclassifiedCustomers: occupancy.unclassified,
      suppressed: occupancy.suppressed,
      territories: occupancy.territories
        .filter(
          row =>
            row.customerCount > 0 ||
            row.guarded ||
            row.territory.presentation.majorLabel
        )
        .map(row => ({
          territoryId: row.territory.id,
          customers: row.customerCount,
          guarded: row.guarded,
          conquered: row.conquered,
        })),
    },
    null,
    2
  )
);
