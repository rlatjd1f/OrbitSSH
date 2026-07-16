# Repository Guidelines

## Scope

These instructions apply to the entire repository.

## Development

- Keep Orbit SSH as a desktop Electron application. Do not replace desktop behavior with a browser-only implementation.
- Preserve existing SSH session, tab, split-pane, keyboard shortcut, and persistence behavior unless a change explicitly requires otherwise.
- Do not commit credentials, private keys, connection data, Keychain exports, build artifacts, or dependency directories.
- Run `npm run build` after source changes.
- Run the Electron UI integration self-test when changing tabs, splits, dialogs, shortcuts, settings, or terminal behavior.

## Code Style

- Use TypeScript for renderer code and CommonJS for the existing Electron main/preload files.
- Prefer small, focused changes that follow the existing React and CSS structure.
- Keep user-facing UI text consistent with the surrounding Korean interface.
- Add or update regression checks when fixing behavior covered by the Electron UI self-test.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit.

Format:

```text
<type>(optional-scope): <short imperative summary>
```

Common types:

- `feat`: add or change user-facing functionality
- `fix`: correct a defect
- `docs`: documentation-only changes
- `style`: formatting or visual changes without behavioral logic changes
- `refactor`: internal restructuring without a feature or bug fix
- `test`: add or update tests
- `build`: build system or dependency changes
- `chore`: repository maintenance

Examples:

```text
feat(terminal): 4분할 터미널 레이아웃 추가
fix(shortcuts): 활성 SSH 세션에 Control+C 전달
docs: 설치 및 사용 방법 추가
```

- Keep the subject concise, imperative, and without a trailing period.
- Use a commit body when the motivation or compatibility impact is not obvious.
- Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.
- When Codex/ChatGPT assisted with the change, include these co-author trailers in the commit body so GitHub can display the collaboration metadata when possible:

```text
Co-authored-by: ChatGPT <chatgpt@openai.com>
Co-authored-by: Codex <codex@openai.com>
```

- Keep the trailers at the end of the commit message body, after any release-note override or breaking-change footer.

## Release Notes Language

- Release notes must explain every change in natural Korean from the user's perspective.
- Keep the Conventional Commit type and optional scope in English, but write the summary after the colon in Korean.
- Do not copy raw English commit subjects, internal implementation jargon, or file-level change descriptions into release notes.
- Explain what changed and how it affects users. Prefer `분할 탭 전환 후 터미널 입력 포커스 자동 복원` over `update focus handler`.
- If an English commit subject is unavoidable, add a Korean release-note override to the commit body:

```text
Release-Note-KO: 사용자가 이해할 수 있는 한글 변경 설명
```

- For an already-pushed historical commit that cannot be amended, add its full commit SHA and Korean explanation to `.github/release-note-overrides.json`.
- Tag release automation must fail when a commit has neither a Korean summary nor a `Release-Note-KO:` override.

## README and Release Note Emoji Style

- Use one relevant emoji at the start of major README and release-note headings to improve scanning.
- Use consistent semantic emoji, such as `🚀` for releases, `✨` for features, `🐛` for fixes, `⚙️` for settings, `⌨️` for shortcuts, `🔐` for security or connections, and `🛠️` for build work.
- Keep heading text meaningful without relying on the emoji so that accessibility and plain-text rendering remain clear.
- Do not add decorative emoji to every bullet, sentence, command, commit subject, or file path.
- Prefer a single precise emoji over multiple adjacent emoji.
