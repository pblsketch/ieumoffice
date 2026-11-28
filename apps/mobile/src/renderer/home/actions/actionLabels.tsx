import type { ReactNode } from 'react'
import {
  HomeActCopyIcon,
  HomeActGroupIcon,
  HomeActImagesToPdfIcon,
  HomeActMergeIcon,
  HomeActRemoveIcon,
  HomeActRenameIcon,
  HomeActSelectIcon,
  HomeActStarIcon,
  HomeActTrashIcon,
} from '../../components/icons/home'
import { IconShare } from '../../components/MobileIcons'
import type { MobileStringKey } from '../../i18n'
import type { HomeBulkAction, HomeRowAction } from './types'

type AnyAction = HomeRowAction | HomeBulkAction

/** Label of each action; the folder bar's [delete] is the short "Delete". */
export function actionLabelKey(action: AnyAction, onBar = false): MobileStringKey {
  switch (action) {
    case 'select':
      return 'homeActSelect'
    case 'share':
      return 'homeActShare'
    case 'rename':
      return 'homeActRename'
    case 'duplicate':
      return 'homeActDuplicate'
    case 'favoriteAdd':
      return 'homeActFavoriteAdd'
    case 'favoriteRemove':
      return 'homeActFavoriteRemove'
    case 'moveToGroup':
      return 'homeActMoveToGroup'
    case 'removeFromList':
      return 'homeActRemoveFromList'
    case 'delete':
      return onBar ? 'homeActDelete' : 'homeActDeleteFile'
    case 'merge':
      return 'homeActMerge'
    case 'imagesToPdf':
      return 'homeActImagesToPdf'
  }
}

export function actionIcon(action: AnyAction, size: number): ReactNode {
  switch (action) {
    case 'select':
      return <HomeActSelectIcon size={size} />
    case 'share':
      return <IconShare size={size} />
    case 'rename':
      return <HomeActRenameIcon size={size} />
    case 'duplicate':
      return <HomeActCopyIcon size={size} />
    case 'favoriteAdd':
      return <HomeActStarIcon size={size} />
    case 'favoriteRemove':
      return <HomeActStarIcon size={size} fill="currentColor" />
    case 'moveToGroup':
      return <HomeActGroupIcon size={size} />
    case 'removeFromList':
      return <HomeActRemoveIcon size={size} />
    case 'delete':
      return <HomeActTrashIcon size={size} />
    case 'merge':
      return <HomeActMergeIcon size={size} />
    case 'imagesToPdf':
      return <HomeActImagesToPdfIcon size={size} />
  }
}
