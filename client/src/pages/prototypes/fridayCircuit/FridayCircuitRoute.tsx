import { useEffect, useState } from "react";
import FridayCircuit, { type Variant } from "./FridayCircuit";

/**
 * /prototypes/friday-circuit (development builds only; see client/src/App.tsx) and the hosted preview. `#neutral`
 * plays the puzzle with neutral labels and no letters; otherwise it carries Nina's sample letters.
 */
const variantFromHash = (): Variant => (window.location.hash === "#neutral" ? "neutral" : "letters");

export default function FridayCircuitRoute({ rookSrc }: { rookSrc?: string }) {
  const [variant, setVariant] = useState<Variant>(variantFromHash);
  useEffect(() => {
    const onHash = () => setVariant(variantFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <FridayCircuit
      key={variant}
      variant={variant}
      rookSrc={rookSrc}
      onVariant={next => {
        window.location.hash = next === "neutral" ? "neutral" : "letters";
        setVariant(next);
      }}
    />
  );
}
