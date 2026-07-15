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
feat(terminal): add four-pane split layout
fix(shortcuts): forward control-c to the active SSH session
docs: add setup and usage instructions
```

- Keep the subject concise, imperative, and without a trailing period.
- Use a commit body when the motivation or compatibility impact is not obvious.
- Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.
