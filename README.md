# Orbit SSH

Orbit SSH는 여러 SSH 서버와 터미널 세션을 한곳에서 관리하기 위한 데스크톱 애플리케이션입니다. 서버를 폴더 트리로 정리하고, 동일한 서버를 여러 탭으로 열거나 하나의 탭 안에서 최대 4개의 터미널을 분할해 사용할 수 있습니다.

현재 macOS를 우선 지원하며 Electron, React, xterm.js, node-pty와 시스템 OpenSSH를 사용합니다.

## 주요 기능

- 폴더 트리 기반 SSH 서버 관리
- 비밀번호 및 SSH 개인 키 인증
- macOS Keychain을 이용한 비밀번호 보관
- 동일 서버의 다중 탭 실행
- 탭 내부 최대 4개 터미널 분할
  - 2~3개: 가로 열 배치
  - 4개: 2×2 격자 배치
- 터미널 출력과 스크롤 기록 유지
- 종료된 터미널의 빠른 재접속
- 터미널 폰트, 글꼴 크기, 줄 간격 및 스크롤 버퍼 설정
- SSH KeepAlive 설정
- 드래그한 터미널 텍스트 자동 복사

## 요구 사항

- macOS
- Node.js와 npm
- 시스템 OpenSSH (`/usr/bin/ssh`)
- Xcode Command Line Tools 또는 node-pty를 빌드할 수 있는 네이티브 빌드 환경

## 설치 및 실행

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

프로덕션 프런트엔드를 빌드한 뒤 Electron으로 실행하려면 다음 명령을 사용합니다.

```bash
npm run desktop:prod
```

node-pty의 Electron 네이티브 모듈을 다시 빌드해야 하는 경우에는 다음 명령을 실행합니다.

```bash
npm run rebuild:native
```

macOS 설치 파일을 로컬에서 생성하려면 다음 명령을 사용합니다. 생성된 DMG와 ZIP 파일은 `release/`에 저장됩니다.

```bash
npm run dist:mac
```

## 자동 릴리즈

`main` 브랜치에 커밋이 푸시될 때마다 GitHub Actions가 다음 작업을 수행합니다.

1. ARM64 및 Intel x64 macOS 러너에서 애플리케이션을 각각 빌드합니다.
2. 각 아키텍처용 DMG와 ZIP 파일을 생성합니다.
3. `build-<실행 번호>` 태그와 함께 GitHub prerelease를 생성합니다.

워크플로는 GitHub의 **Actions → Build and Release → Run workflow**에서도 수동으로 실행할 수 있습니다.

현재 자동 빌드에는 Apple Developer ID 코드 서명과 공증이 적용되지 않습니다. 따라서 다운로드한 앱을 처음 실행할 때 macOS Gatekeeper 경고가 표시될 수 있습니다.

## SSH 연결 등록

1. 왼쪽 사이드바에서 **새 폴더**를 눌러 서버를 분류할 폴더를 만듭니다.
2. **새 커넥션**을 누릅니다.
3. 장비 이름, 호스트, 포트와 사용자를 입력합니다.
4. 비밀번호 또는 SSH 개인 키 인증을 선택합니다.
5. **추가**를 눌러 저장합니다.
6. 사이드바의 서버를 더블 클릭해 새 터미널 탭을 엽니다.

비밀번호 인증을 선택하면 비밀번호는 연결 설정 JSON에 기록하지 않고 macOS Keychain의 `OrbitSSH` 서비스에 저장합니다. 개인 키 경로를 비워두면 SSH Agent 또는 OpenSSH 기본 키를 사용합니다.

## 터미널 사용법

- 같은 서버를 반복해서 더블 클릭하면 매번 독립적인 새 탭이 열립니다.
- `Command+D`를 누르면 현재 탭 안에 터미널이 하나씩 추가됩니다.
- 분할 터미널은 탭당 최대 4개까지 열 수 있습니다.
- 분할된 화면을 클릭하면 해당 터미널이 활성화됩니다.
- 연결이 종료된 화면에서 `Enter`를 누르면 같은 패널에서 다시 접속합니다.
- 터미널 텍스트를 드래그하면 선택한 내용이 클립보드에 자동 복사됩니다.

## 단축키

| 단축키 | 동작 |
| --- | --- |
| `Control+Tab` | 다음 탭으로 이동하고 터미널에 포커스 |
| `Command+D` | 현재 탭 내부에 터미널 분할 추가 |
| `Command+W` / `Control+W` | 활성 분할 패널 닫기, 마지막 패널이면 탭 닫기 |
| `Control+C` | 원격 터미널의 현재 입력 또는 작업 중단 |
| `Control+D` | 원격 셸에 EOF 전달 |
| `Command+C` | 선택한 터미널 텍스트 복사 |
| `Command+,` | 전역 설정 열기 |
| `Escape` | 열려 있는 폴더, 연결 또는 설정 팝업 닫기 |

## 설정

`Command+,`를 눌러 다음 전역 설정을 변경할 수 있습니다.

- 터미널 폰트, 글꼴 크기와 줄 간격
- 커서 깜빡임
- 탭당 스크롤 버퍼 크기(기본 5,000줄)
- 기본 포트와 인증 방식
- SSH KeepAlive 간격

## 데이터 저장 위치

연결과 설정은 Electron의 macOS 사용자 데이터 디렉터리에 저장됩니다.

```text
~/Library/Application Support/Orbit SSH/connections.json
~/Library/Application Support/Orbit SSH/settings.json
```

비밀번호는 위 파일에 포함되지 않으며 macOS Keychain에 별도로 저장됩니다.

## 개발 명령

```bash
# Vite 개발 서버
npm run dev

# TypeScript 검사 및 프런트엔드 빌드
npm run build

# Electron 데스크톱 개발 모드
npm run desktop

# node-pty Electron ABI 재빌드
npm run rebuild:native
```

## 프로젝트 구조

```text
electron/
  main.cjs       Electron 메인 프로세스, SSH PTY 및 앱 단축키
  preload.cjs    안전한 렌더러 IPC 브리지
src/
  main.tsx       React UI와 탭·분할·연결 상태 관리
  styles.css     기본 애플리케이션 스타일
  features.css   터미널, 팝업, 설정 등 기능별 스타일
```

## 라이선스

현재 별도의 라이선스가 지정되어 있지 않습니다.
