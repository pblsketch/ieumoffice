import type { zh } from './zh'

export const ko = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'WebDAV 서버(Nextcloud, 시놀로지 NAS 등)를 연결하면 서버의 파일을 열 수 있습니다. 저장하면 고친 내용이 서버로 돌아갑니다.',
  webdavNoServers: '연결한 서버가 아직 없습니다.',
  webdavAdd: '서버 추가',
  webdavFieldName: '이름',
  webdavFieldUrl: '서버 주소',
  webdavFieldUser: '사용자 이름',
  webdavFieldPassword: '비밀번호 또는 앱 비밀번호',
  webdavUserHint: '로그인이 필요 없는 서버면 사용자 이름을 비워 두세요.',
  webdavInsecureWarn:
    '암호화되지 않은 HTTP 연결입니다. 비밀번호와 파일이 읽을 수 있는 상태로 네트워크를 지나갑니다.',
  webdavInsecureConfirm: '위험을 알고 HTTP로 연결합니다',
  webdavSave: '연결',
  webdavCancel: '취소',
  webdavChecking: '연결을 확인하는 중…',
  webdavRemove: '서버 삭제',
  webdavRemoveConfirm:
    '이 PC에서 이 서버의 연결 정보를 지울까요? 서버에 있는 파일은 지워지지 않습니다.',
  webdavRemoveYes: '삭제',
  webdavNeedPassword: '이 PC에서는 비밀번호를 암호화해 보관하지 못했습니다. 다시 입력하세요.',
  webdavNotPersisted:
    '이 PC에서는 비밀번호를 암호화해 보관할 수 없어서, 앱을 닫으면 다시 입력해야 합니다.',
  webdavPrivacy:
    '비밀번호는 이 PC에만, 시스템 암호화로 보관됩니다. 파일은 열거나 저장할 때만 입력한 서버와 오갑니다.',
  webdavEmptyTitle: '연결된 WebDAV 서버가 없습니다',
  webdavEmptyBody: '설정 → 연동에서 서버를 추가하면 여기서 서버의 파일을 둘러보고 열 수 있습니다.',
  webdavOpenSettings: '설정 열기',
  webdavRoot: '루트',
  webdavFolderEmpty: '이 폴더는 비어 있습니다.',
  webdavLoading: '불러오는 중…',
  webdavRefresh: '새로 고침',
  webdavUnsupported: '앱에서 열 수 없는 형식입니다',
  webdavOpening: '여는 중…',
  webdavServer: '서버',
  webdavErrUrl:
    '주소가 올바르지 않습니다. https:// 또는 http://로 시작하는 전체 주소를 입력하세요.',
  webdavErrInsecure: '암호화되지 않은 HTTP를 쓰려면 확인 칸을 먼저 체크해야 합니다.',
  webdavErrAuth:
    '서버가 로그인을 거절했습니다. 사용자 이름과 비밀번호를 확인하세요(앱 비밀번호가 필요한 서비스가 많습니다).',
  webdavErrNotFound: '서버에 그 폴더나 파일이 없습니다.',
  webdavErrForbidden: '이 계정에는 그 작업을 할 권한이 없습니다.',
  webdavErrNetwork: '서버에 닿지 못했습니다. 주소와 네트워크를 확인하세요.',
  webdavErrLimit: '서버는 최대 10개까지 연결할 수 있습니다.',
  webdavErrTooLarge: '파일이 너무 커서 열 수 없습니다.',
  webdavErrRateLimit: '서버가 잠시 뒤에 다시 시도하라고 합니다.',
  webdavErrLocked: '다른 사람이 이 파일을 잠가 두었습니다.',
  webdavErrDisk: '파일을 이 PC에 저장하지 못했습니다.',
} satisfies Record<keyof typeof zh, string>
