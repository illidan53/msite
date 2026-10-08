import type {
  BacktestReport,
  BookSnapshot,
  FamilyAdmission,
  LatestSnapshot,
  RunId,
  Signal,
  SignalAction,
  WarningCode,
} from "../../shared/strategy";
import { familyLabels } from "../../shared/strategyRules";
import { DEFAULT_PUBLIC_BASE_URL } from "./mailer";

/**
 * E-mail bodies for the Quant System. Every value is escaped; layout is
 * inline-styled tables only, because mail clients drop <style> blocks and
 * most CSS layout. Tickers, rule ids and numbers stay in English in both
 * locales; numbers go through Intl.
 */

export type EmailLocale = "en" | "zh";
export interface EmailOptions {
  locale: EmailLocale;
  baseUrl: string;
  /** Shown in the footer of messages that carry no hash of their own. */
  configHash?: string;
}
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const copy = {
  en: {
    signals: "[Quant signals]",
    weekly: "[Quant weekly]",
    system: "[Quant system]",
    sharpe: "Sharpe",
    decided: (asOf: string) =>
      `Orders decided after the ${asOf} close, for the next session's open.`,
    noOrders: "No orders for this book.",
    columns: ["Action", "Symbol", "Class", "Shares", "≈ Notional", "Weight", "Forecast", "Drivers"],
    actions: { entry: "Entry", add: "Add", trim: "Trim", exit: "Exit" } as Record<SignalAction, string>,
    reasons: { removed: "removed from book", ineligible: "ineligible" },
    paper: "Paper account",
    paperFields: ["Since", "Equity", "Cash", "Day", "Total", "SPY", "Positions", "Gross"],
    open: "Open the Quant System (Analytics → Quant System)",
    disclaimer:
      "Research output, not investment advice. Prices are split-adjusted price returns; dividends are excluded.",
    hash: "Config hash",
    weeklyTitle: "Weekly backtest report",
    window: (start: string, end: string, sessions: number) =>
      `Evaluation window ${start} → ${end} (${sessions} sessions)`,
    runColumns: ["Run", "Sharpe", "CAGR", "Max drawdown", "Vol"],
    runs: {
      core: "Core system",
      risk_parity_buy_hold: "Risk-parity buy & hold",
      spy_buy_hold: "SPY buy & hold",
      equal_weight_buy_hold: "Equal-weight buy & hold",
    } as Partial<Record<RunId, string>>,
    familyColumns: ["Family", "ΔSharpe", "95% interval", "Admission"],
    admission: {
      adds: "adds",
      neutral: "neutral",
      detracts: "detracts",
      insufficient: "insufficient data",
    } as Record<FamilyAdmission, string>,
    dsr: "Deflated Sharpe probability",
    pbo: "Probability of backtest overfitting",
    warnings: "Warnings",
    noWarnings: "No warnings.",
    warningCodes: {
      forecast_scale: "Forecast scale",
      cost_budget: "Cost budget",
      short_window: "Short window",
      data_failures: "Data failures",
      price_jumps: "Price jumps",
      family_detracts: "Family detracts",
    } as Record<WarningCode, string>,
    jobs: { daily: "Daily signals", backtest: "Weekly backtest" },
    failed: "failed",
    failureBody: (job: string) => `The ${job.toLowerCase()} job failed.`,
    message: "Message",
    nextRetry: "Next retry",
    noRetry: "No more automatic retries today.",
    nyTime: "New York time",
    testTitle: "Test email",
    testBody: (transport: string) =>
      `E-mail delivery is configured (transport: ${transport}). Signal digests, weekly reports and failure alerts will arrive at this address.`,
  },
  zh: {
    signals: "[量化信号]",
    weekly: "[量化周报]",
    system: "[量化系统]",
    sharpe: "夏普",
    decided: (asOf: string) => `订单于 ${asOf} 收盘后决定，在下一交易日开盘成交。`,
    noOrders: "本组合今日无订单。",
    columns: ["操作", "代码", "类别", "股数", "约合金额", "权重", "预测", "主要驱动"],
    actions: { entry: "建仓", add: "加仓", trim: "减仓", exit: "清仓" } as Record<SignalAction, string>,
    reasons: { removed: "已移出组合", ineligible: "不满足条件" },
    paper: "模拟盘",
    paperFields: ["起始", "权益", "现金", "当日", "累计", "SPY", "持仓数", "总敞口"],
    open: "打开量化系统（分析 → 量化系统）",
    disclaimer: "仅供研究，不构成投资建议。价格为拆股调整后的价格收益，不含分红。",
    hash: "配置哈希",
    weeklyTitle: "每周回测报告",
    window: (start: string, end: string, sessions: number) =>
      `评估区间 ${start} → ${end}（${sessions} 个交易日）`,
    runColumns: ["方案", "夏普", "年化复合收益", "最大回撤", "波动率"],
    runs: {
      core: "核心系统",
      risk_parity_buy_hold: "风险平价买入持有",
      spy_buy_hold: "SPY 买入持有",
      equal_weight_buy_hold: "等权买入持有",
    } as Partial<Record<RunId, string>>,
    familyColumns: ["规则族", "夏普差", "95% 区间", "准入结论"],
    admission: {
      adds: "增益",
      neutral: "中性",
      detracts: "拖累",
      insufficient: "样本不足",
    } as Record<FamilyAdmission, string>,
    dsr: "紧缩夏普概率",
    pbo: "回测过拟合概率",
    warnings: "警告",
    noWarnings: "无警告。",
    warningCodes: {
      forecast_scale: "预测尺度",
      cost_budget: "成本预算",
      short_window: "样本区间过短",
      data_failures: "数据获取失败",
      price_jumps: "价格跳变",
      family_detracts: "规则族拖累",
    } as Record<WarningCode, string>,
    jobs: { daily: "每日信号", backtest: "每周回测" },
    failed: "失败",
    failureBody: (job: string) => `${job}任务运行失败。`,
    message: "错误信息",
    nextRetry: "下次重试",
    noRetry: "今日不再自动重试。",
    nyTime: "纽约时间",
    testTitle: "测试邮件",
    testBody: (transport: string) =>
      `邮件发送已配置（传输方式：${transport}）。信号摘要、周报和失败提醒将发送到此地址。`,
  },
};

const reportRuns: RunId[] = [
  "core",
  "risk_parity_buy_hold",
  "spy_buy_hold",
  "equal_weight_buy_hold",
];

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links are rendered; anything else falls back to the public site. */
function homeUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:")
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;
  } catch {
    // fall through
  }
  return `${DEFAULT_PUBLIC_BASE_URL}/`;
}

function formatters(locale: EmailLocale) {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (options: Intl.NumberFormatOptions) => {
    const key = JSON.stringify(options);
    let f = cache.get(key);
    if (!f) cache.set(key, (f = new Intl.NumberFormat(tag, options)));
    return f;
  };
  const ok = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v);
  const dash = "—";
  return {
    num: (v: number | null | undefined, digits = 2) =>
      ok(v)
        ? nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)
        : dash,
    signed: (v: number | null | undefined, digits = 2) =>
      ok(v)
        ? nf({
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
            signDisplay: "exceptZero",
          }).format(v)
        : dash,
    pct: (v: number | null | undefined, digits = 2, sign = false) =>
      ok(v)
        ? `${nf({
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
            signDisplay: sign ? "exceptZero" : "auto",
          }).format(v)}%`
        : dash,
    shares: (v: number) =>
      nf({ maximumFractionDigits: 4, signDisplay: "exceptZero" }).format(v),
    money: (v: number | null | undefined) =>
      ok(v)
        ? nf({ style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v)
        : dash,
    int: (v: number) => nf({ maximumFractionDigits: 0 }).format(v),
  };
}

const style = {
  body: "margin:0;padding:0;background:#ffffff",
  wrap:
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2933;max-width:760px;margin:0 auto;padding:16px",
  h1: "font-size:18px;line-height:1.3;margin:0 0 4px;color:#102a43",
  h2: "font-size:16px;line-height:1.3;margin:24px 0 6px;color:#102a43",
  muted: "margin:0 0 10px;color:#52606d;font-size:13px",
  table: "border-collapse:collapse;width:100%;font-size:13px;margin:0 0 8px",
  th: "text-align:left;padding:6px 8px;border-bottom:2px solid #cbd2d9;background:#f5f7fa;font-weight:600;white-space:nowrap",
  td: "text-align:left;padding:6px 8px;border-bottom:1px solid #e4e7eb;vertical-align:top",
  tdNum: "text-align:right;padding:6px 8px;border-bottom:1px solid #e4e7eb;vertical-align:top;white-space:nowrap;font-variant-numeric:tabular-nums",
  link: "color:#0b6bcb",
  footer: "margin:24px 0 0;padding-top:12px;border-top:1px solid #e4e7eb;font-size:12px;color:#7b8794",
};

interface Cell {
  value: string;
  numeric?: boolean;
}
const cell = (value: string, numeric = false): Cell => ({ value, numeric });

function htmlTable(head: string[] | null, rows: Cell[][], numericHead: boolean[] = []) {
  const th = head
    ? `<tr>${head
        .map(
          (h, i) =>
            `<th style="${style.th}${numericHead[i] ? ";text-align:right" : ""}">${escapeHtml(h)}</th>`,
        )
        .join("")}</tr>`
    : "";
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((c) => `<td style="${c.numeric ? style.tdNum : style.td}">${escapeHtml(c.value)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${style.table}">${th}${body}</table>`;
}

function page(locale: EmailLocale, inner: string, footer: string) {
  const lang = locale === "zh" ? "zh-CN" : "en";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="${style.body}"><div style="${style.wrap}">${inner}<p style="${style.footer}">${footer}</p></div></body></html>`;
}

function footer(locale: EmailLocale, hashes: string[]) {
  const c = copy[locale];
  const unique = [...new Set(hashes.filter(Boolean))];
  const hashLine = unique.length ? `${c.hash}: ${unique.join(", ")}` : "";
  return {
    text: [c.disclaimer, hashLine].filter(Boolean).join("\n"),
    html: [escapeHtml(c.disclaimer), hashLine && escapeHtml(hashLine)]
      .filter(Boolean)
      .join("<br>"),
  };
}

function linkBlock(locale: EmailLocale, baseUrl: string) {
  const url = homeUrl(baseUrl);
  const c = copy[locale];
  return {
    text: `${c.open}: ${url}`,
    html: `<p style="margin:16px 0 0"><a href="${escapeHtml(url)}" style="${style.link}">${escapeHtml(c.open)}</a></p>`,
  };
}

function signalCells(signal: Signal, locale: EmailLocale) {
  const c = copy[locale];
  const f = formatters(locale);
  const action =
    c.actions[signal.action] +
    (signal.reason === "forecast" ? "" : ` (${c.reasons[signal.reason]})`);
  const drivers = signal.drivers
    .map((d) => `${d.rule} ${f.signed(d.contribution, 1)}`)
    .join(", ");
  return [
    cell(action),
    cell(signal.symbol),
    cell(signal.class || "—"),
    cell(f.shares(signal.shares), true),
    cell(f.money(Math.abs(signal.notional)), true),
    cell(`${f.pct(signal.fromWeight)} → ${f.pct(signal.toWeight)}`, true),
    cell(f.num(signal.forecast, 1), true),
    cell(drivers || "—"),
  ];
}

function paperCells(book: BookSnapshot, locale: EmailLocale) {
  const f = formatters(locale);
  const p = book.paper;
  return [
    p.inception,
    f.money(p.equity),
    f.money(p.cash),
    f.pct(p.dayReturn, 2, true),
    f.pct(p.totalReturn, 2, true),
    f.pct(p.benchmarkReturn, 2, true),
    f.int(p.positions),
    f.pct(p.gross, 1),
  ];
}

/** Daily digest: one section per book with its orders and paper account. */
export function renderSignalDigest(
  snapshot: LatestSnapshot,
  options: EmailOptions,
): RenderedEmail {
  const { locale } = options;
  const c = copy[locale];
  const counts = snapshot.books
    .map((b) => `${b.name[locale]} ${b.signals.length}`)
    .join(" / ");
  const subject = `${c.signals} ${snapshot.asOf} · ${counts}`;
  const text: string[] = [subject, ""];
  const html: string[] = [
    `<h1 style="${style.h1}">${escapeHtml(subject)}</h1>`,
    `<p style="${style.muted}">${escapeHtml(c.decided(snapshot.asOf))}</p>`,
  ];
  text.push(c.decided(snapshot.asOf), "");
  for (const book of snapshot.books) {
    const title = `${book.name[locale]} · ${book.asOf}`;
    html.push(`<h2 style="${style.h2}">${escapeHtml(title)}</h2>`);
    text.push(title);
    if (book.signals.length) {
      const rows = book.signals.map((s) => signalCells(s, locale));
      html.push(htmlTable(c.columns, rows, [false, false, false, true, true, true, true, false]));
      for (const row of rows) text.push(`- ${row.map((r) => r.value).join(" | ")}`);
    } else {
      html.push(`<p style="${style.muted}">${escapeHtml(c.noOrders)}</p>`);
      text.push(c.noOrders);
    }
    const paper = paperCells(book, locale);
    html.push(
      `<p style="${style.muted};margin-top:10px"><strong>${escapeHtml(c.paper)}</strong></p>`,
      htmlTable(
        c.paperFields,
        [paper.map((v, i) => cell(v, i > 0))],
        c.paperFields.map((_, i) => i > 0),
      ),
    );
    text.push(
      `${c.paper}: ${c.paperFields.map((label, i) => `${label} ${paper[i]}`).join(" · ")}`,
      "",
    );
  }
  const link = linkBlock(locale, options.baseUrl);
  const foot = footer(locale, [
    ...snapshot.books.map((b) => b.configHash),
    options.configHash ?? "",
  ]);
  html.push(link.html);
  text.push(link.text, "", foot.text);
  return { subject, text: text.join("\n"), html: page(locale, html.join(""), foot.html) };
}

/** Weekly report: core against the benchmarks, family admission and warnings. */
export function renderWeeklyReport(
  report: BacktestReport,
  options: EmailOptions,
): RenderedEmail {
  const { locale } = options;
  const c = copy[locale];
  const f = formatters(locale);
  const headline = report.books
    .map((b) => {
      const core = b.runs.find((r) => r.id === "core");
      return `${b.name[locale]} ${c.sharpe} ${f.num(core?.stats.sharpe ?? null)}`;
    })
    .join(" / ");
  const subject = `${c.weekly} ${report.asOf} · ${headline}`;
  const text: string[] = [subject, ""];
  const html: string[] = [`<h1 style="${style.h1}">${escapeHtml(subject)}</h1>`];
  for (const book of report.books) {
    const window = c.window(book.window.start, book.window.end, book.window.sessions);
    html.push(
      `<h2 style="${style.h2}">${escapeHtml(book.name[locale])}</h2>`,
      `<p style="${style.muted}">${escapeHtml(window)}</p>`,
    );
    text.push(book.name[locale], window);
    const runRows = reportRuns.flatMap((id) => {
      const run = book.runs.find((r) => r.id === id);
      if (!run) return [];
      const s = run.stats;
      return [
        [
          cell(c.runs[id] ?? id),
          cell(f.num(s.sharpe), true),
          cell(f.pct(s.cagr, 1), true),
          cell(f.pct(s.maxDrawdown, 1), true),
          cell(f.pct(s.annualVol, 1), true),
        ],
      ];
    });
    html.push(htmlTable(c.runColumns, runRows, [false, true, true, true, true]));
    for (const row of runRows) text.push(`- ${row.map((r) => r.value).join(" | ")}`);
    const familyRows = book.tests.families.map((fam) => [
      cell(familyLabels[fam.family][locale]),
      cell(f.signed(fam.difference), true),
      cell(
        fam.interval
          ? `[${f.signed(fam.interval[0])}, ${f.signed(fam.interval[1])}]`
          : "—",
        true,
      ),
      cell(c.admission[fam.status]),
    ]);
    if (familyRows.length) {
      html.push(htmlTable(c.familyColumns, familyRows, [false, true, true, false]));
      text.push("");
      for (const row of familyRows) text.push(`- ${row.map((r) => r.value).join(" | ")}`);
    }
    const tests = `${c.dsr}: ${f.pct(
      book.tests.deflatedSharpe.probability === null
        ? null
        : book.tests.deflatedSharpe.probability * 100,
      0,
    )} · ${c.pbo}: ${f.pct(
      book.tests.overfitting.probability === null
        ? null
        : book.tests.overfitting.probability * 100,
      0,
    )}`;
    html.push(`<p style="${style.muted}">${escapeHtml(tests)}</p>`);
    text.push(tests);
    const warnings = book.warnings.map(
      (w) => `${c.warningCodes[w.code] ?? w.code}: ${w.detail}`,
    );
    html.push(
      `<p style="${style.muted};margin-top:10px"><strong>${escapeHtml(c.warnings)}</strong></p>`,
      warnings.length
        ? `<ul style="margin:0 0 8px;padding-left:20px;font-size:13px">${warnings
            .map((w) => `<li>${escapeHtml(w)}</li>`)
            .join("")}</ul>`
        : `<p style="${style.muted}">${escapeHtml(c.noWarnings)}</p>`,
    );
    text.push(`${c.warnings}:`, ...(warnings.length ? warnings.map((w) => `- ${w}`) : [c.noWarnings]), "");
  }
  const link = linkBlock(locale, options.baseUrl);
  const foot = footer(locale, [report.configHash, options.configHash ?? ""]);
  html.push(link.html);
  text.push(link.text, "", foot.text);
  return { subject, text: text.join("\n"), html: page(locale, html.join(""), foot.html) };
}

function newYorkTime(iso: string, locale: EmailLocale) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${copy[locale].nyTime})`;
}

/** Sent once a scheduled job has exhausted its retries (or a backtest fails). */
export function renderFailure(
  input: { job: "daily" | "backtest"; message: string; nextRetry: string | null },
  options: EmailOptions,
): RenderedEmail {
  const { locale } = options;
  const c = copy[locale];
  const job = c.jobs[input.job];
  const subject = `${c.system} ${job}${locale === "zh" ? "" : " "}${c.failed}`;
  const next = input.nextRetry ? newYorkTime(input.nextRetry, locale) : c.noRetry;
  const rows = [
    [cell(c.message), cell(input.message || "—")],
    [cell(c.nextRetry), cell(next)],
  ];
  const link = linkBlock(locale, options.baseUrl);
  const foot = footer(locale, [options.configHash ?? ""]);
  const html = [
    `<h1 style="${style.h1}">${escapeHtml(subject)}</h1>`,
    `<p style="${style.muted}">${escapeHtml(c.failureBody(job))}</p>`,
    htmlTable(null, rows),
    link.html,
  ];
  const text = [
    subject,
    "",
    c.failureBody(job),
    `${c.message}: ${input.message || "—"}`,
    `${c.nextRetry}: ${next}`,
    "",
    link.text,
    "",
    foot.text,
  ];
  return { subject, text: text.join("\n"), html: page(locale, html.join(""), foot.html) };
}

/** Configuration check from the "Send test email" button. */
export function renderTest(
  options: EmailOptions & { transport: string },
): RenderedEmail {
  const { locale } = options;
  const c = copy[locale];
  const subject = `${c.system} ${c.testTitle}`;
  const body = c.testBody(options.transport);
  const link = linkBlock(locale, options.baseUrl);
  const foot = footer(locale, [options.configHash ?? ""]);
  return {
    subject,
    text: [subject, "", body, "", link.text, "", foot.text].join("\n"),
    html: page(
      locale,
      `<h1 style="${style.h1}">${escapeHtml(subject)}</h1><p style="margin:0 0 10px">${escapeHtml(body)}</p>${link.html}`,
      foot.html,
    ),
  };
}
