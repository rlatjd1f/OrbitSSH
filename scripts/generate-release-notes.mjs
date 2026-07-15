import { execFileSync } from "node:child_process";

const previousTag = process.argv[2] ?? "";
const currentTag = process.argv[3];

if (!currentTag) {
  console.error("Usage: node scripts/generate-release-notes.mjs [previous-tag] <current-tag>");
  process.exit(1);
}

const repository = process.env.GITHUB_REPOSITORY ?? "rlatjd1f/OrbitSSH";
const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;
const log = execFileSync(
  "git",
  ["log", "--reverse", "--format=%H%x1f%s%x1f%b%x1e", range],
  { encoding: "utf8" },
);

const sections = [
  ["breaking", "호환성 변경"],
  ["feat", "새로운 기능"],
  ["fix", "버그 수정"],
  ["perf", "성능 개선"],
  ["style", "UI 및 스타일"],
  ["refactor", "내부 개선"],
  ["docs", "문서"],
  ["test", "테스트"],
  ["maintenance", "빌드 및 유지보수"],
  ["other", "기타 변경"],
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
  const summary = conventional?.[4] ?? subject;
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

const lines = ["## 업데이트 내역", ""];
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
    `**전체 변경 내역:** [${previousTag}...${currentTag}](https://github.com/${repository}/compare/${previousTag}...${currentTag})`,
    "",
  );
}

process.stdout.write(`${lines.join("\n").trimEnd()}\n`);
