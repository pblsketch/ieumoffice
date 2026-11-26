// The split planning helpers moved to @genoffice/pdf-ops (shared with the phone app).
// This file keeps every name it exported for its importers.
export {
  MAX_SPLIT_MAX_BYTES,
  MIN_SPLIT_MAX_BYTES,
  cutAfterToRanges,
  formatPartPages,
  formatSplitOutputNames,
  formatSplitRangeList,
  parseSplitRangeList,
  planBookmarkParts,
  planSplitParts,
  rangesToCutAfter,
  sanitizeSplitName,
  splitSubfolderName,
} from '@genoffice/pdf-ops'
export type {
  SplitBookmarkEntry,
  SplitFixedKind,
  SplitMode,
  SplitNamingPattern,
  SplitOutputOptions,
  SplitPartPlan,
  SplitPlanError,
  SplitPlanRequest,
  SplitPlanResult,
  SplitRange,
  SplitSizeUnit,
} from '@genoffice/pdf-ops'
