-- President Stage 1 only. No preflight, work-order, execution, review, or release lifecycle.
CREATE TABLE IF NOT EXISTS `president_assessments` (
 `id` varchar(64) NOT NULL, `seat` varchar(64) NOT NULL, `inspectedRepositorySha` varchar(40) NOT NULL,
 `evidenceSnapshotId` varchar(80) NOT NULL, `status` varchar(32) NOT NULL, `resultState` varchar(64) NOT NULL,
 `availableSourcesJson` json NOT NULL, `unavailableSourcesJson` json NOT NULL, `provider` varchar(64) NOT NULL,
 `model` varchar(128) NOT NULL, `startedAt` timestamp NOT NULL, `completedAt` timestamp NOT NULL,
 PRIMARY KEY (`id`), UNIQUE KEY `uq_president_assessment_evidence` (`inspectedRepositorySha`,`evidenceSnapshotId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `president_candidate_projects` (
 `id` varchar(64) NOT NULL, `assessmentId` varchar(64) NOT NULL, `title` varchar(191) NOT NULL,
 `missingCapability` text NOT NULL, `currentGap` text NOT NULL, `proposedBuild` text NOT NULL,
 `resultingCapability` text NOT NULL, `rank` int NOT NULL, `rankReason` text NOT NULL,
 `evidenceJson` json NOT NULL, `blockersJson` json NOT NULL, `humanDecisionDependency` text,
 `status` varchar(64) NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_president_candidate_rank` (`assessmentId`,`rank`),
 KEY `idx_president_candidates_assessment` (`assessmentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
