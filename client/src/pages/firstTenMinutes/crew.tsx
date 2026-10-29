import { motion, useReducedMotion } from "framer-motion";
import type { CompanionId } from "@shared/firstTenMinutesFindings";
import styles from "./firstTen.module.css";

/**
 * The crew, small and at the edges. Sable, Mara, Luma and Rook use their existing art (Adam's descriptions:
 * Sable the magenta masked fox in a yellow jacket, Mara the orange fox in a blue work jacket and beanie, Rook the green
 * bird with the red spotted beak, camo bucket hat and satchel). Bront, Ilex and Orren have no art yet; they act
 * through their objects until they do.
 */
export const CREW_ART: Partial<Record<CompanionId, { src: string; alt: string }>> = {
  sable: { src: "/assets/first-ten/crew/sable.webp", alt: "Sable" },
  mara: { src: "/assets/first-ten/crew/mara.webp", alt: "Mara" },
  luma: { src: "/assets/first-ten/crew/luma.webp", alt: "Luma" },
  rook: { src: "/assets/first-ten/crew/rook.webp", alt: "Rook" },
};

export function CrewMember({
  who,
  from = "bottom",
  delay = 0,
  className,
}: {
  who: CompanionId;
  from?: "bottom" | "left" | "right";
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const art = CREW_ART[who];
  if (!art) return null;
  const offset = from === "left" ? { x: -60 } : from === "right" ? { x: 60 } : { y: 70 };
  return (
    <motion.img
      src={art.src}
      alt={art.alt}
      className={`${styles.crewMember} ${className ?? ""}`}
      data-crew={who}
      initial={reduce ? false : { opacity: 0, ...offset }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ type: "spring", stiffness: 140, damping: 18, delay }}
      draggable={false}
    />
  );
}
