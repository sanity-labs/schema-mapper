// Public entry point for the complexity-analysis library.
//
// All exports here are pure: no React, no SDK, no DOM. The same code powers
// the Analyze-mode UI and is intended to back a Node CLI in a follow-up.

export {walkSchema, formatPath} from './walkSchema'
export type {SchemaPath, WalkOptions} from './walkSchema'

export {walkDocument} from './walkDocument'
export type {DocPath, WalkDocumentResult} from './walkDocument'

export {computePathStats} from './pathStats'
export type {
  HotPath,
  UnusedField,
  UndeclaredPath,
  DeadPath,
  DriftPath,
  DataPathRecord,
  PathStatsInput,
  PathStatsResult,
} from './pathStats'

export {synthesizeFindings} from './findings'
export type {DocTypeFinding, FindingsSummary} from './findings'

export {detectPatterns} from './patterns'
export type {PatternFinding, PatternKind} from './patterns'

export {buildDepthHistogram, depthOf} from './depthHistogram'
export type {DepthRow, DepthHistogramResult} from './depthHistogram'

export {analyze} from './analyze'
export type {AnalyzeInput, AnalyzeOptions, AnalyzeResult} from './analyze'

export {buildMarkdownReport, buildCsvReport, timestampSlug} from './exportReport'
export type {ExportContext, ExportInput} from './exportReport'
