import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { SessionManager, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type RepoStats = {
  files: number;
  added: number;
  deleted: number;
  ahead: number;
  behind: number;
};

type CostTotals = {
  month: number;
};

const EMPTY_REPO: RepoStats = {
  files: 0,
  added: 0,
  deleted: 0,
  ahead: 0,
  behind: 0,
};

const EMPTY_COSTS: CostTotals = {
  month: 0,
};

const GIT_REFRESH_MS = 10_000;
const COST_REFRESH_MS = 60_000;
const MONTHLY_CAP = readNumber(process.env.PI_MONTHLY_CAP ?? process.env.CLAUDE_MONTHLY_CAP, 300);

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthKey(date: Date): string {
  return dateKey(date).slice(0, 7);
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${value}`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function costFromValue(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const usage = value as { usage?: { cost?: { total?: unknown } } };
  const total = usage.usage?.cost?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

function costFromEntry(entry: SessionEntry): number {
  if (entry.type === "message") return costFromValue(entry.message);
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return costFromValue(entry);
  }
  return 0;
}

function sessionCost(entries: readonly SessionEntry[]): number {
  return entries.reduce((total, entry) => total + costFromEntry(entry), 0);
}

function addEntryCost(totals: CostTotals, entry: SessionEntry, now: Date): void {
  const cost = costFromEntry(entry);
  if (cost === 0) return;

  const timestamp = new Date(entry.timestamp);
  if (Number.isNaN(timestamp.getTime())) return;

  const key = dateKey(timestamp);
  if (key.startsWith(monthKey(now))) totals.month += cost;
}

async function loadCostTotals(): Promise<CostTotals> {
  const totals = { ...EMPTY_COSTS };
  const now = new Date();
  const sessions = await SessionManager.listAll();

  await Promise.all(
    sessions.map(async (session) => {
      try {
        const content = await readFile(session.path, "utf8");
        const entries = parseSessionEntries(content);
        for (const entry of entries) {
          if (entry.type !== "session") addEntryCost(totals, entry, now);
        }
      } catch {
        // Ignore sessions that disappear or contain an incomplete final line.
      }
    }),
  );

  return totals;
}

function parseClaudeMonth(output: string): number {
  const payload = JSON.parse(output) as {
    daily?: Array<{ period?: unknown; totalCost?: unknown }>;
  };
  const currentMonth = monthKey(new Date());
  return (payload.daily ?? []).reduce((total, entry) => {
    if (typeof entry.period !== "string" || !entry.period.startsWith(currentMonth)) return total;
    const cost = typeof entry.totalCost === "number" ? entry.totalCost : Number(entry.totalCost);
    return Number.isFinite(cost) ? total + cost : total;
  }, 0);
}

async function loadClaudeMonth(pi: ExtensionAPI): Promise<number | null> {
  const command = [
    "if command -v bunx >/dev/null 2>&1; then",
    "bunx ccusage@latest daily --mode calculate --json",
    "elif command -v npx >/dev/null 2>&1; then",
    "npx --yes ccusage@latest daily --mode calculate --json",
    "else",
    "exit 127",
    "fi",
  ].join(" ");
  const result = await pi.exec("sh", ["-lc", command], { timeout: 120_000 });
  if (result.code !== 0 || result.stdout.trim() === "") return null;

  try {
    return parseClaudeMonth(result.stdout);
  } catch {
    return null;
  }
}

function parseNumstat(output: string): Pick<RepoStats, "files" | "added" | "deleted"> {
  const stats = { files: 0, added: 0, deleted: 0 };
  for (const line of output.split("\n")) {
    const [added, deleted] = line.split("\t");
    if (!/^\d+$/.test(added ?? "") || !/^\d+$/.test(deleted ?? "")) continue;
    stats.files += 1;
    stats.added += Number(added);
    stats.deleted += Number(deleted);
  }
  return stats;
}

async function loadRepoStats(pi: ExtensionAPI, cwd: string): Promise<RepoStats> {
  const stats = { ...EMPTY_REPO };
  const diff = await pi.exec("git", ["--no-optional-locks", "-C", cwd, "diff", "HEAD", "--numstat"], {
    cwd,
    timeout: 2_000,
  });

  if (diff.code === 0) Object.assign(stats, parseNumstat(diff.stdout));

  const upstream = await pi.exec(
    "git",
    ["--no-optional-locks", "-C", cwd, "rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    { cwd, timeout: 2_000 },
  );
  if (upstream.code === 0) {
    const [behind, ahead] = upstream.stdout.trim().split(/\s+/).map(Number);
    if (Number.isFinite(ahead)) stats.ahead = ahead;
    if (Number.isFinite(behind)) stats.behind = behind;
  }

  return stats;
}

function progressBar(percent: number): string {
  const filled = Math.max(0, Math.min(10, Math.floor(percent / 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

export default function (pi: ExtensionAPI) {
  let requestRender = () => {};
  let repoStats = { ...EMPTY_REPO };
  let costTotals = { ...EMPTY_COSTS };
  let claudeMonth: number | null = null;
  let repoRefreshActive = false;
  let costRefreshActive = false;
  let claudeRefreshActive = false;

  const refreshRepo = async (cwd: string) => {
    if (repoRefreshActive) return;
    repoRefreshActive = true;
    try {
      repoStats = await loadRepoStats(pi, cwd);
    } catch {
      repoStats = { ...EMPTY_REPO };
    } finally {
      repoRefreshActive = false;
      requestRender();
    }
  };

  const refreshCosts = async () => {
    if (costRefreshActive) return;
    costRefreshActive = true;
    try {
      costTotals = await loadCostTotals();
    } catch {
      costTotals = { ...EMPTY_COSTS };
    } finally {
      costRefreshActive = false;
      requestRender();
    }
  };

  const refreshClaudeMonth = async () => {
    if (claudeRefreshActive) return;
    claudeRefreshActive = true;
    try {
      claudeMonth = await loadClaudeMonth(pi);
    } catch {
      claudeMonth = null;
    } finally {
      claudeRefreshActive = false;
      requestRender();
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const stopBranchWatch = footerData.onBranchChange(() => {
        void refreshRepo(ctx.cwd);
      });
      const gitTimer = setInterval(() => void refreshRepo(ctx.cwd), GIT_REFRESH_MS);
      const costTimer = setInterval(() => {
        void refreshCosts();
        void refreshClaudeMonth();
      }, COST_REFRESH_MS);

      void refreshRepo(ctx.cwd);
      void refreshCosts();
      void refreshClaudeMonth();

      const renderRow = (value: string, width: number): string => {
        const contentWidth = Math.max(1, width - 4);
        const truncated = truncateToWidth(value, contentWidth, "");
        const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(truncated)));
        return `${theme.fg("border", "│")} ${truncated}${padding} ${theme.fg("border", "│")}`;
      };

      const renderHeader = (label: string, width: number, left: string, right: string): string => {
        const fill = Math.max(0, width - label.length - 5);
        return theme.fg("border", `${left}─ ${label} ${"─".repeat(fill)}${right}`);
      };

      return {
        dispose() {
          clearInterval(gitTimer);
          clearInterval(costTimer);
          stopBranchWatch();
          requestRender = () => {};
        },
        invalidate() {},
        render(width: number): string[] {
          const branch = footerData.getGitBranch();
          const project = basename(ctx.cwd) || ctx.cwd;
          let repo = project;
          if (branch) {
            repo += ` ${theme.fg("accent", branch)}`;
            if (repoStats.ahead > 0) repo += ` ${theme.fg("success", `↑${repoStats.ahead}`)}`;
            if (repoStats.behind > 0) repo += ` ${theme.fg("warning", `↓${repoStats.behind}`)}`;
            if (repoStats.files > 0) {
              repo += ` ${repoStats.files}f ${theme.fg("success", `+${repoStats.added}`)} ${theme.fg("error", `-${repoStats.deleted}`)}`;
            }
          }

          const model = ctx.model?.name ?? ctx.model?.id ?? "no-model";
          const effort = ctx.thinkingLevel ?? "default";
          const usage = ctx.getContextUsage();
          const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const percent = usage?.percent == null ? 0 : Math.max(0, Math.min(100, Math.floor(usage.percent)));
          const contextLabel = contextWindow > 0 ? formatTokens(contextWindow) : "?";
          const contextText = usage?.percent == null ? `?% of ${contextLabel}` : `${percent}% of ${contextLabel}`;
          const barColor = percent >= 90 ? "error" : percent >= 70 ? "warning" : "success";
          const session = sessionCost(ctx.sessionManager.getBranch());
          const totalMonth = claudeMonth === null ? null : costTotals.month + claudeMonth;
          const capPercent = totalMonth === null || MONTHLY_CAP <= 0 ? 0 : Math.floor((totalMonth / MONTHLY_CAP) * 100);
          const costColor = capPercent >= 90 ? "error" : capPercent >= 70 ? "warning" : "success";
          const claudeText = claudeMonth === null ? "?" : formatUsd(claudeMonth);
          const totalText = totalMonth === null ? "?" : formatUsd(totalMonth);
          let costs = `${theme.fg("warning", "💰")} session ${formatUsd(session)} · pi ${formatUsd(costTotals.month)} · claude ${claudeText} · ${theme.fg(costColor, `total ${totalText}`)}/${formatUsd(MONTHLY_CAP)}`;
          const extensionStatuses = Array.from(footerData.getExtensionStatuses().values()).filter(Boolean).join(" · ");
          if (extensionStatuses) costs += ` · ${extensionStatuses}`;

          const stats = `${model} ${effort} ${theme.fg("dim", "│")} ${theme.fg(barColor, `${progressBar(percent)} ${contextText}`)} ${theme.fg("dim", "│")} ${costs}`;
          const rows = [repo, stats];
          if (width < 26) return rows.map((row) => truncateToWidth(row, width, ""));

          const widest = Math.max(...rows.map((row) => visibleWidth(row)), 24);
          const panelWidth = Math.min(width, widest + 4);

          return [
            renderHeader("REPO", panelWidth, "╭", "╮"),
            renderRow(repo, panelWidth),
            renderHeader("SESSION", panelWidth, "├", "┤"),
            renderRow(stats, panelWidth),
            theme.fg("border", `╰${"─".repeat(Math.max(0, panelWidth - 2))}╯`),
          ];
        },
      };
    });
  });

  pi.on("model_select", () => requestRender());
  pi.on("thinking_level_select", () => requestRender());
  pi.on("turn_end", () => {
    requestRender();
    void refreshCosts();
    void refreshClaudeMonth();
  });
}
