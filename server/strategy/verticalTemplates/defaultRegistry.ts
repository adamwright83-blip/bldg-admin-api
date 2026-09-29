import { laundryFluffFoldTemplate } from "./laundryFluffFold";
import {
  laundryActiveCustomersMetricReader,
  laundryNetSalesMetricReader,
  laundryNewPayingCustomersMetricReader,
  laundryPaidOrdersMetricReader,
} from "./laundryMetricReaders";
import { ServerVerticalRegistry } from "./registry";

/**
 * Composition root. Generic/core modules consume the VerticalRegistry interface;
 * concrete vertical imports live here, not inside persistent-operator logic.
 */
export const defaultVerticalRegistry = new ServerVerticalRegistry();
defaultVerticalRegistry.registerTemplate(laundryFluffFoldTemplate);
defaultVerticalRegistry.registerMetricReader(
  "strategy.active_customers.v1",
  laundryActiveCustomersMetricReader
);
defaultVerticalRegistry.registerMetricReader(
  "strategy.new_paying_customers.v1",
  laundryNewPayingCustomersMetricReader
);
defaultVerticalRegistry.registerMetricReader(
  "strategy.paid_orders_per_period.v1",
  laundryPaidOrdersMetricReader
);
defaultVerticalRegistry.registerMetricReader(
  "strategy.net_sales_per_period.v1",
  laundryNetSalesMetricReader
);
