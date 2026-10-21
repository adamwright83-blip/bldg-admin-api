import { useState } from "react";
import {
  NEIGHBORHOOD_FEATURES,
  type NeighborhoodFeatureChoice,
} from "@shared/playableVillagers";
import styles from "./cozy-neighborhood.module.css";

interface NeighborhoodCourtyardFeatureProps {
  chosenFeature: NeighborhoodFeatureChoice | null;
  onChooseFeature: (choice: NeighborhoodFeatureChoice) => void;
}

export function NeighborhoodCourtyardFeature({
  chosenFeature,
  onChooseFeature,
}: NeighborhoodCourtyardFeatureProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const featureConfig = chosenFeature ? NEIGHBORHOOD_FEATURES[chosenFeature] : null;

  return (
    <>
      {/* Visual Placed Feature in the Courtyard */}
      <div
        className={styles.courtyardFeatureAnchor}
        style={{
          position: "absolute",
          left: "38%",
          top: "60%",
          transform: "translate(-50%, -50%)",
          zIndex: 35,
          cursor: "pointer",
        }}
        onClick={() => setIsDialogOpen(true)}
        role="button"
        tabIndex={0}
        aria-label={
          featureConfig
            ? `${featureConfig.name} in Silver Lake Square. Click to change.`
            : "Empty Silver Lake Courtyard Spot. Click to place a neighborhood feature."
        }
        data-testid="neighborhood-courtyard-spot"
        data-chosen-feature={chosenFeature ?? "unplaced"}
      >
        {featureConfig ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              position: "relative",
            }}
          >
            {/* Glowing Ground Ring */}
            <div
              style={{
                width: 76,
                height: 38,
                borderRadius: "50%",
                background: "radial-gradient(ellipse, rgba(247, 183, 51, 0.45) 0%, transparent 70%)",
                position: "absolute",
                bottom: -6,
                pointerEvents: "none",
              }}
            />

            {/* Feature Icon Display */}
            <div
              style={{
                fontSize: 34,
                filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.45))",
                transition: "transform 0.2s",
                userSelect: "none",
              }}
            >
              {featureConfig.icon}
            </div>

            {/* Name Tag Pill */}
            <div
              style={{
                background: "rgba(43, 33, 26, 0.9)",
                border: "1px solid #d29d4c",
                borderRadius: 12,
                padding: "2px 8px",
                fontSize: 10,
                fontWeight: 700,
                color: "#fcecd7",
                marginTop: 2,
                whiteSpace: "nowrap",
                boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
              }}
            >
              {featureConfig.name}
            </div>
          </div>
        ) : (
          /* Unplaced Spot Prompt */
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "rgba(43, 33, 26, 0.85)",
              border: "1.5px dashed #d29d4c",
              borderRadius: 16,
              padding: "4px 10px",
              color: "#fcecd7",
              fontSize: 11,
              fontWeight: 700,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              animation: "pulse 2s infinite",
            }}
          >
            <span>✨</span>
            <span>+ Place Courtyard Feature</span>
          </div>
        )}
      </div>

      {/* Placement Choice Modal Dialog */}
      {isDialogOpen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(18, 14, 26, 0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setIsDialogOpen(false)}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #2b211a 0%, #1e1713 100%)",
              border: "2px solid #8e6840",
              borderRadius: 16,
              maxWidth: 460,
              width: "100%",
              padding: 20,
              color: "#fcecd7",
              boxShadow: "0 12px 35px rgba(0,0,0,0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="neighborhood-choice-modal"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                borderBottom: "1px solid #573f2c",
                paddingBottom: 8,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, color: "#f7b733", fontWeight: 800 }}>
                🏡 Silver Lake Courtyard
              </h3>
              <button
                type="button"
                onClick={() => setIsDialogOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#d1ba9f",
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: "#d9be9e", lineHeight: 1.4, margin: "0 0 16px 0" }}>
              The villagers want to make the courtyard cozy for everyone. Choose an outdoor feature
              to place under the cedar trees — your choice will be remembered on returning!
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Option A: Tea Table */}
              <button
                type="button"
                style={{
                  background:
                    chosenFeature === "tea_table"
                      ? "rgba(247, 183, 51, 0.2)"
                      : "rgba(255, 255, 255, 0.05)",
                  border:
                    chosenFeature === "tea_table"
                      ? "2px solid #f7b733"
                      : "1.5px solid rgba(220, 185, 145, 0.3)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  color: "#fcecd7",
                }}
                onClick={() => {
                  onChooseFeature("tea_table");
                  setIsDialogOpen(false);
                }}
                data-testid="choose-tea-table"
              >
                <span style={{ fontSize: 28 }}>🍵</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#f7b733" }}>
                    {NEIGHBORHOOD_FEATURES.tea_table.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#cbb297", marginTop: 2 }}>
                    {NEIGHBORHOOD_FEATURES.tea_table.description}
                  </div>
                </div>
              </button>

              {/* Option B: Reading Bench */}
              <button
                type="button"
                style={{
                  background:
                    chosenFeature === "reading_bench"
                      ? "rgba(247, 183, 51, 0.2)"
                      : "rgba(255, 255, 255, 0.05)",
                  border:
                    chosenFeature === "reading_bench"
                      ? "2px solid #f7b733"
                      : "1.5px solid rgba(220, 185, 145, 0.3)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  color: "#fcecd7",
                }}
                onClick={() => {
                  onChooseFeature("reading_bench");
                  setIsDialogOpen(false);
                }}
                data-testid="choose-reading-bench"
              >
                <span style={{ fontSize: 28 }}>🌸</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#f7b733" }}>
                    {NEIGHBORHOOD_FEATURES.reading_bench.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#cbb297", marginTop: 2 }}>
                    {NEIGHBORHOOD_FEATURES.reading_bench.description}
                  </div>
                </div>
              </button>
              {/* Option C: Lantern Post */}
              <button
                type="button"
                style={{
                  background:
                    chosenFeature === "lantern_post"
                      ? "rgba(247, 183, 51, 0.2)"
                      : "rgba(255, 255, 255, 0.05)",
                  border:
                    chosenFeature === "lantern_post"
                      ? "2px solid #f7b733"
                      : "1.5px solid rgba(220, 185, 145, 0.3)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  color: "#fcecd7",
                }}
                onClick={() => {
                  onChooseFeature("lantern_post");
                  setIsDialogOpen(false);
                }}
                data-testid="choose-lantern-post"
              >
                <span style={{ fontSize: 28 }}>🏮</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#f7b733" }}>
                    {NEIGHBORHOOD_FEATURES.lantern_post.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#cbb297", marginTop: 2 }}>
                    {NEIGHBORHOOD_FEATURES.lantern_post.description}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
