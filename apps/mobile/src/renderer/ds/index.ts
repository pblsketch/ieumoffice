// Mobile design system parts (docs/plans/mobile-v1/DSN.md). Parts hold no text of their
// own: every name, label and message comes from the caller's strings. Importing this
// module loads ds.css, which only styles ds-* classes.
import './ds.css'

export { ICON_SIZE, iconPx, PROGRESS_DELAY_MS, type IconSize } from './sizes'
export { Icon, type IconProps } from './Icon'
export {
  Button,
  IconButton,
  Chip,
  type ButtonProps,
  type ButtonVariant,
  type IconButtonProps,
  type ChipProps,
} from './Buttons'
export {
  ChoiceGroup,
  Swatch,
  type ChoiceGroupProps,
  type ChoiceOption,
  type SwatchProps,
} from './Choices'
export {
  Switch,
  SwitchRow,
  SettingsGroup,
  ListRow,
  ActionList,
  type SwitchProps,
  type SwitchRowProps,
  type SettingsGroupProps,
  type ListRowProps,
  type ActionItem,
  type ActionListProps,
} from './Lists'
export {
  ScreenHeader,
  EmptyState,
  StickyActions,
  InlineNotice,
  FloatingTools,
  PageIndicator,
  type ScreenHeaderProps,
  type EmptyStateProps,
  type InlineNoticeProps,
  type FloatingToolsProps,
  type PageIndicatorProps,
} from './Layout'
export {
  Spinner,
  LinearProgress,
  DocSkeleton,
  useDelayedVisible,
  type SpinnerProps,
  type LinearProgressProps,
  type DocSkeletonProps,
} from './Progress'
export { canShowTip, boxesOverlap, pickTipBox, type TipScreenState, type Box } from './tips'
