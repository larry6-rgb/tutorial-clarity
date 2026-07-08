-- Product direction changed: video indexing moved from a Chrome-extension
-- overlay to a plain website search feature (no extension involved), so the
-- extension activation-key gating this table existed for is no longer needed.
-- Table had zero real rows (built and reverted same day), safe to drop.
DROP TABLE "TCExtensionActivation";
