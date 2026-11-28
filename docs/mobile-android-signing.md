# 모바일 Android 고정 서명 및 Google Play 내부 테스트 안내

이음오피스 모바일(`com.ieumoffice.mobile`)의 Android 빌드(`.apk` / `.aab`)는 GitHub Actions(`.github/workflows/mobile-build.yml`)에서 고정 업로드 키스토어로 자동 서명됩니다.

## 1. 고정 서명 키 (GitHub Secrets)

다음 4개 Secret이 저장소에 등록되어 있으면 `Mobile Build` 워크플로가 자동으로 **고정 릴리스 서명 APK**와 **Google Play 업로드용 서명 AAB**를 함께 빌드합니다.

| Secret 이름                 | 설명                                           |
| --------------------------- | ---------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | PKCS12 업로드 키스토어 파일의 Base64 인코딩 값 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호                              |
| `ANDROID_KEY_ALIAS`         | 서명 키 별칭(`ieumoffice-upload`)              |
| `ANDROID_KEY_PASSWORD`      | 키 비밀번호                                    |

- 4개 Secret이 없는 포크 PR에서는 임시 테스트 키로 APK만 서명해 CI 검증을 유지합니다.
- 매 CI 실행마다 `versionCode`는 `1000 + GITHUB_RUN_NUMBER`로 자동 증가하므로 Google Play 버전 코드 충돌이 나지 않습니다.
- 원본 키스토어 파일과 비밀번호는 저장소에 절대 커밋하지 않고, 오프라인 암호화 백업으로만 보관합니다.

## 2. Google Play 내부 테스트 연결 절차

1. [Google Play Console](https://play.google.com/console)에서 앱을 새로 만들고 패키지 이름 `com.ieumoffice.mobile`에 GitHub Actions 아티팩트 **`ieumoffice-mobile-android-aab`**(`ieumoffice-mobile-arm64.aab`)를 **최초 1회 수동 업로드**합니다. (Google Play 정책상 앱의 첫 AAB 업로드는 콘솔에서 직접 해야 합니다.)
2. 내부 테스트 트랙에 테스터 이메일 목록을 등록하고 초대 링크로 폰에 설치합니다.
3. 이후 자동 업로드를 켜려면:
   - Google Cloud에서 서비스 계정을 만들고 JSON 키를 발급합니다.
   - Play Console → **사용자 및 권한**에서 해당 서비스 계정에 앱 출시 관리 권한을 부여합니다.
   - GitHub 저장소 Secrets에 `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` 이름으로 JSON 전문을 등록합니다.
4. GitHub Actions → **Mobile Build** → **Run workflow**에서 `publish_play_internal: true`를 선택해 실행하면 서명된 AAB가 내부 테스트 트랙으로 자동 업로드됩니다.
   - 앱이 아직 Play Console에 정식 등록되기 전(초안 상태)이면 `release_status`를 `draft`로 두고, 등록 완료 뒤에는 `completed`로 선택합니다.
