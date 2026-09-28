import { laundryFluffFoldTemplate } from "./laundryFluffFold";
import { ServerVerticalRegistry } from "./registry";

/**
 * Composition root. Generic/core modules consume the VerticalRegistry interface;
 * concrete vertical imports live here, not inside persistent-operator logic.
 */
export const defaultVerticalRegistry = new ServerVerticalRegistry();
defaultVerticalRegistry.registerTemplate(laundryFluffFoldTemplate);
