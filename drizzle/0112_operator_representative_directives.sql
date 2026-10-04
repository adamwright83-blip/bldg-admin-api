CREATE TABLE `operator_representative_directives` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `targetItemId` varchar(191) NOT NULL,
  `targetKey` varchar(191),
  `directiveKind` enum('correction','suppress','ask_instead') NOT NULL,
  `operatorDeclaredValueJson` json,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active',
  `createdByOpenId` varchar(191) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `revokedAt` timestamp(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_operator_rep_directive_operator_target` (
    `tenantId`, `canonicalOperatorId`, `targetItemId`, `status`
  ),
  INDEX `idx_operator_rep_directive_operator_created` (
    `tenantId`, `canonicalOperatorId`, `createdAt`
  )
);
