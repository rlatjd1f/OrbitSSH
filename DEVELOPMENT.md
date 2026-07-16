# 🛠️ Orbit SSH 개발자 가이드

이 문서는 Orbit SSH를 소스에서 실행하거나 빌드, 테스트, 릴리즈하는 개발자를 위한 안내입니다. 앱 사용 방법은 [README.md](README.md)를 참고하세요.

## 📋 개발 요구 사항

- macOS
- Node.js와 npm
- 시스템 OpenSSH (`/usr/bin/ssh`)
- Xcode Command Line Tools 또는 `node-pty`를 빌드할 수 있는 네이티브 빌드 환경

## 🚀 로컬 실행

저장소를 복제하고 의존성을 설치합니다.

```bash
git clone https://github.com/rlatjd1f/OrbitSSH.git
cd OrbitSSH
npm install
```

개발 모드로 데스크톱 앱을 실행합니다.

```bash
npm run desktop
```

`npm run desktop`은 업데이트 UI 테스트를 쉽게 하기 위해 앱 내부 표시 버전과 업데이트 비교 기준을 `0.0.0`으로 고정합니다. 실제 릴리즈 버전과 패키징 검증에는 `package.json`의 버전이 그대로 사용됩니다.

프로덕션 프런트엔드를 빌드한 뒤 Electron으로 실행하려면 다음 명령을 사용합니다.

```bash
npm run desktop:prod
```

## 🧪 테스트와 빌드

TypeScript 검사와 프런트엔드 빌드를 실행합니다.

```bash
npm run build
```

`node-pty`의 Electron 네이티브 모듈을 다시 빌드해야 하는 경우에는 다음 명령을 실행합니다.

```bash
npm run rebuild:native
```

터미널, 탭, 분할, 팝업, 단축키, 설정, 업데이트 UI를 변경했다면 Electron UI 통합 셀프테스트를 실행합니다.

```bash
npm run dev -- --host 127.0.0.1
ORBIT_UI_SELF_TEST=1 ORBIT_DEV_URL=http://127.0.0.1:5173 ./node_modules/.bin/electron .
```

## 📦 macOS 패키징

macOS 설치 파일을 로컬에서 생성하려면 다음 명령을 사용합니다. 생성된 DMG 파일은 `release/`에 저장됩니다.

```bash
npm run dist:mac
```

현재 자동 빌드에는 Apple Developer ID 공증이 적용되지 않습니다. 공개 배포에서 Gatekeeper 경고를 없애려면 Apple Developer ID 인증서로 코드 서명하고 Apple notarization을 적용해야 합니다.

## 🚀 자동 릴리즈

`v`로 시작하는 버전 태그가 원격에 푸시될 때만 GitHub Actions가 릴리즈를 생성합니다. 일반 브랜치 커밋이나 `main` 푸시만으로는 릴리즈가 생성되지 않습니다.

자동 릴리즈 작업은 다음 순서로 진행됩니다.

1. ARM64 및 Intel x64 macOS 러너에서 애플리케이션을 각각 빌드합니다.
2. 각 아키텍처용 DMG 파일을 생성합니다.
3. 이전 버전 태그부터 현재 태그까지의 커밋을 유형별로 정리한 릴리즈 노트를 생성합니다.
4. 푸시된 버전 태그를 기준으로 GitHub Release를 생성합니다.

각 릴리즈에는 다음 네 가지 다운로드 항목만 표시됩니다.

- 소스 코드 ZIP(GitHub 자동 생성)
- 소스 코드 TAR.GZ(GitHub 자동 생성)
- macOS ARM64 DMG
- macOS Intel x64 DMG

## 📝 릴리즈 노트 작성 규칙

릴리즈 노트의 변경 설명은 사용자 관점의 자연스러운 한글로 작성해야 합니다. Conventional Commit의 타입과 범위는 영문을 유지하되 요약은 한글로 작성합니다.

```text
feat(terminal): 분할 탭 전환 후 입력 포커스 자동 복원
```

영문 커밋 제목을 사용해야 한다면 커밋 본문에 한글 설명을 추가합니다.

```text
Release-Note-KO: 분할된 터미널 사이를 이동할 때 입력 포커스를 자동으로 복원
```

한글 요약이나 `Release-Note-KO:` 설명이 없는 변경사항이 있으면 릴리즈 작업이 실패합니다.

## 🏷️ 태그 배포

태그는 `package.json`의 버전과 일치해야 합니다. 예를 들어 버전이 `0.1.0`이면 다음과 같이 릴리즈합니다.

```bash
git tag v0.1.0
git push origin v0.1.0
```

버전을 올리고 커밋과 태그를 함께 생성하려면 npm의 버전 명령을 사용할 수 있습니다.

```bash
npm version patch -m "chore(release): 버전 v%s 배포"
git push origin main --follow-tags
```

## 🗂️ 프로젝트 구조

```text
electron/
  main.cjs       Electron 메인 프로세스, SSH PTY 및 앱 단축키
  preload.cjs    안전한 렌더러 IPC 브리지
src/
  main.tsx       React UI와 탭·분할·연결 상태 관리
  styles.css     기본 애플리케이션 스타일
  features.css   터미널, 팝업, 설정 등 기능별 스타일
```
