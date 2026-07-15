import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const previousTag = process.argv[2] ?? "";
const currentTag = process.argv[3];

if (!currentTag) {
  console.error("Usage: node scripts/generate-release-notes.mjs [previous-tag] <current-tag>");
  process.exit(1);
}

const repository = process.env.GITHUB_REPOSITORY ?? "rlatjd1f/OrbitSSH";
let summaryOverrides = {};
try {
  summaryOverrides = JSON.parse(
    readFileSync(".github/release-note-overrides.json", "utf8"),
  );
} catch {}
const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
const log = execFileSync(
  "git",
  ["log", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", range],
  { encoding: "utf8" },
);

const sections = [
  ["breaking", "⚠️ 호환성 변경"],
  ["feat", "✨ 새로운 기능"],
  ["fix", "🐛 버그 수정"],
  ["perf", "⚡ 성능 개선"],
  ["style", "🎨 UI 및 스타일"],
  ["refactor", "♻️ 내부 개선"],
  ["docs", "📝 문서"],
  ["test", "✅ 테스트"],
  ["maintenance", "🛠️ 빌드 및 유지보수"],
  ["other", "📦 기타 변경"],
];
const entries = new Map(sections.map(([key]) => [key, []]));

for (const record of log.split("\x1e")) {
  const [hash, subject = "", body = ""] = record.trim().split("\x1f");
  if (!hash || !subject) continue;

  const conventional = subject.match(
    /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/i,
  );
  const type = conventional?.[1]?.toLowerCase();
  const scope = conventional?.[2];
  const breaking = Boolean(conventional?.[3]) || /BREAKING CHANGE:/i.test(body);
  const koreanOverride = body.match(/^Release-Note-KO:\s*(.+)$/im)?.[1]?.trim();
  const summary =
    summaryOverrides[hash] ?? koreanOverride ?? conventional?.[4] ?? subject;
  if (!/[가-힣]/.test(summary)) {
    console.error(
      `Commit ${hash.slice(0, 7)} needs a Korean summary or Release-Note-KO override: ${subject}`,
    );
    process.exit(1);
  }
  const key = breaking
    ? "breaking"
    : ["feat", "fix", "perf", "style", "refactor", "docs", "test"].includes(
          type,
        )
      ? type
      : ["build", "ci", "chore"].includes(type)
        ? "maintenance"
        : "other";
  const scopeLabel = scope ? `**${scope}:** ` : "";
  const shortHash = hash.slice(0, 7);
  entries
    .get(key)
    .push(
      `- ${scopeLabel}${summary} ([\`${shortHash}\`](https://github.com/${repository}/commit/${hash}))`,
    );
}

const lines = ["## 🚀 업데이트 내역", ""];
let hasEntries = false;

for (const [key, title] of sections) {
  const items = entries.get(key);
  if (!items.length) continue;
  hasEntries = true;
  lines.push(`### ${title}`, "", ...items, "");
}

if (!hasEntries) lines.push("- 이전 버전 이후 변경 내역이 없습니다.", "");

if (previousTag) {
  lines.push(
    `**🔗 전체 변경 내역:** [${previousTag}...${currentTag}](https://github.com/${repository}/compare/${previousTag}...${currentTag})`,
    "",
  );
}

lines.push(
  "## 🍎 Mac에 맞는 설치 파일 선택",
  "",
  "- **Apple Silicon Mac(M1, M2, M3, M4 등):** 파일명에 `arm64`가 포함된 DMG를 받으세요.",
  "- **Intel Mac:** 파일명에 `x64`가 포함된 DMG를 받으세요.",
  "- `Source code (zip)`과 `Source code (tar.gz)`는 개발용 소스 코드이며 일반 앱 설치 파일이 아닙니다.",
  "",
  "Mac 종류는 **Apple 메뉴() → 이 Mac에 관하여**에서 확인할 수 있습니다. `칩`에 Apple M 시리즈가 표시되면 Apple Silicon이고, `프로세서`에 Intel이 표시되면 Intel Mac입니다.",
  "",
  "터미널에서 `uname -m`을 실행했을 때 `arm64`이면 Apple Silicon용, `x86_64`이면 Intel용 DMG를 선택하세요.",
  "",
);

process.stdout.write(`${lines.join("\n").trimEnd()}\n`);
