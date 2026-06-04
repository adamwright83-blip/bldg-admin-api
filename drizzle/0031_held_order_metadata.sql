ALTER TABLE `orders`
  ADD `heldRawRequestText` text,
  ADD `heldCleanedRequestText` text,
  ADD `heldServiceSummary` text,
  ADD `heldRequestedPickupWindow` varchar(255),
  ADD `heldRequestedReturnBy` varchar(255),
  ADD `heldSource` varchar(64),
  ADD `heldMetadataJson` json;
