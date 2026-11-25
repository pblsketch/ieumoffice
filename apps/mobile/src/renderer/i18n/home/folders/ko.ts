import type { zh } from './zh'

export const ko = {
  homeFolderListLabel: '연결한 폴더',
  homeFolderEmptyTitle: '연결한 폴더가 없습니다',
  homeFolderEmptyBody: '자주 쓰는 폴더를 연결하면 그 안의 문서와 사진이 여기에 바로 보여요.',
  homeFolderLink: '폴더 연결',
  homeFolderRelink: '다시 연결',
  homeFolderRelinkNamed: '{name} 다시 연결',
  homeFolderOk: '연결됨',
  homeFolderLostRevoked: '이 폴더를 쓸 수 있는 허락이 사라졌습니다. 다시 연결해 주세요.',
  homeFolderLostMissing: '폴더를 찾을 수 없습니다. 옮기거나 지웠다면 다시 연결해 주세요.',
  homeFolderLost: '폴더에 들어갈 수 없습니다. 폴더를 다시 연결해 주세요.',
  homeFolderMenu: '{name} 메뉴',
  homeFolderRemove: '빼기',
  homeFolderRemoveTitle: '{name} 폴더를 뺄까요?',
  homeFolderRemoveBody:
    '이 폴더 안 파일의 최근·즐겨찾기 {count}개 줄도 함께 빠집니다. 파일은 지워지지 않습니다.',
  homeFolderRemoved: '폴더를 뺐습니다.',
  homeFolderBack: '위 폴더로',
  homeFolderPath: '지금 폴더',
  homeFolderSubfolder: '폴더',
  homeFolderInsideEmpty: '이 폴더에는 열 수 있는 문서나 사진이 없습니다.',
} as const satisfies Record<keyof typeof zh, string>
