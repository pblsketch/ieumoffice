// Making a PDF smaller moved to @genoffice/pdf-ops (shared with the phone app).
// This file keeps every name it exported for its importers.
export {
  COMPRESS_LEVELS,
  LEVEL_TARGETS,
  compressPdfBytes,
  samplesToBgra,
  sourceOf,
} from '@genoffice/pdf-ops'
export type {
  CompressLevel,
  CompressResult,
  ImageRecoder,
  RecodedImage,
  SourceImage,
} from '@genoffice/pdf-ops'
