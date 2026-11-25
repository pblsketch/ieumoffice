// The [Folders] tab of the home (linked document folders, spec 3.5). Owned by track T6.
import type { ComponentType } from 'react'
import { FoldersView } from './folders/FoldersView'
import type { HomeTabProps } from './homeTabs'

export const FoldersTab: ComponentType<HomeTabProps> = ({ host }) => <FoldersView host={host} />
