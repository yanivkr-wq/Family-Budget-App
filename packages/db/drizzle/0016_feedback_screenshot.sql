-- Add a column to store an inline base64-encoded PNG screenshot for feedback
-- items captured via the camera button in the feedback widget. NULL when
-- the feedback was submitted text-only.
--
-- Stored inline (text) to keep deployment simple — no S3, no separate file
-- storage. PNGs from html2canvas are typically 50-300KB at a tab-sized
-- viewport; postgres handles this comfortably for the tens-of-rows scale
-- this single-user app generates.

ALTER TABLE feedback
  ADD COLUMN screenshot_data text;
