import type {
  BacktestReport,
  BacktestWarning,
  BookSnapshot,
  FamilyAdmission,
  LatestSnapshot,
  RuleFamily,
  RuleId,
  RunId,
  Signal,
  SignalAction,
  WarningCode,
} from "../../shared/strategy";
import { familyLabels } from "../../shared/strategyRules";
import { DEFAULT_PUBLIC_BASE_URL } from "./mailer";
import { signGatedRules } from "./ruleCurves";

/**
 * E-mail bodies for the Quant System. Every value is escaped; layout is
 * inline-styled tables only, because mail clients drop <style> blocks and
 * most CSS layout. Tickers, rule ids and numbers stay in English in both
 * locales; numbers go through Intl.
 */

/**
 * Orders listed per book in the digest. Gmail clips HTML past ~102 KB, which
 * would hide the later books and the disclaimer; above this the digest counts
 * orders by action and lists the largest by notional.
 */
export const DIGEST_MAX_ORDERS = 40;
/** Rule drivers shown per order (spec §7: the top three). */
const MAX_DRIVERS = 3;
const actionOrder: SignalAction[] = ["entry", "add", "trim", "exit"];

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
    orderCounts: (total: string, counts: string) => `${total} orders: ${counts}.`,
    largest: (shown: string, more: string) =>
      `The ${shown} largest by notional are listed; ${more} more are on the Quant System page.`,
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
      forecast_scale: "Mean |forecast| outside 7–13",
      cost_budget: "Costs above a third of the core Sharpe",
      short_window: "Evaluation window under two years",
      data_failures: "Symbols that failed to load",
      history_trimmed: "Early history trimmed at a bad print",
      price_jumps: "One-session price moves over 40%",
      family_detracts: "Rule families that detract",
    } as Record<WarningCode, string>,
    listSeparator: ", ",
    gateOpen: (rules: string) => ` (${rules} measured on sessions with the trend gate open)`,
    costBudget: (cost: string, sharpe: string) =>
      `cost ${cost} in Sharpe units vs core Sharpe ${sharpe}`,
    sessions: (count: string) => `${count} sessions`,
    more: (count: string) => `… and ${count} more`,
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
    orderCounts: (total: string, counts: string) => `共 ${total} 笔订单：${counts}。`,
    largest: (shown: string, more: string) =>
      `下表列出金额最大的 ${shown} 笔，其余 ${more} 笔请在量化系统页面查看。`,
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
      forecast_scale: "平均 |预测值| 超出 7–13",
      cost_budget: "成本超过核心夏普的三分之一",
      short_window: "评估区间不足两年",
      data_failures: "数据加载失败的标的",
      history_trimmed: "早期历史已在异常价位截断",
      price_jumps: "单日价格变动超过 40%",
      family_detracts: "拖累表现的规则族",
    } as Record<WarningCode, string>,
    listSeparator: "、",
    gateOpen: (rules: string) => `（${rules} 按趋势门控开启的交易日计算）`,
    costBudget: (cost: string, sharpe: string) => `成本折合夏普 ${cost}，核心夏普 ${sharpe}`,
    sessions: (count: string) => `${count} 个交易日`,
    more: (count: string) => `… 另有 ${count} 项`,
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
  notice: "margin:0 0 12px;padding:8px 10px;background:#f5f7fa;font-size:12px;color:#52606d",
  table:
    "border-collapse:collapse;width:100%;font-size:13px;line-height:1.4;font-variant-numeric:tabular-nums;margin:0 0 8px",
  th: "border-bottom:2px solid #cbd2d9;background:#f5f7fa;font-weight:600;white-space:nowrap",
  stripe: "#f5f7fa",
  link: "color:#0b6bcb",
  footer: "margin:24px 0 0;padding-top:12px;border-top:1px solid #e4e7eb;font-size:12px;color:#7b8794",
};

interface Cell {
  value: string;
  numeric?: boolean;
}
const cell = (value: string, numeric = false): Cell => ({ value, numeric });

/**
 * Shared styles sit on <table> once; cells only carry attributes (padding via
 * cellpadding, alignment, zebra stripes), because a style string per cell made
 * a 100-order digest larger than Gmail's clipping limit.
 */
function htmlTable(head: string[] | null, rows: Cell[][], numericHead: boolean[] = []) {
  const th = head
    ? `<tr>${head
        .map(
          (h, i) =>
            `<th align="${numericHead[i] ? "right" : "left"}" style="${style.th}">${escapeHtml(h)}</th>`,
        )
        .join("")}</tr>`
    : "";
  const body = rows
    .map(
      (row, r) =>
        `<tr valign="top"${r % 2 ? ` bgcolor="${style.stripe}"` : ""}>${row
          .map((c) => `<td${c.numeric ? ' align="right"' : ""}>${escapeHtml(c.value)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table${head ? "" : ' role="presentation"'} cellpadding="6" cellspacing="0" border="0" style="${style.table}">${th}${body}</table>`;
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
  const anchor = `<a href="${escapeHtml(url)}" style="${style.link}">${escapeHtml(c.open)}</a>`;
  return {
    text: `${c.open}: ${url}`,
    anchor,
    html: `<p style="margin:16px 0 0">${anchor}</p>`,
  };
}

/**
 * Signals carry the top three drivers; the cap is repeated here so a longer
 * list can never inflate the digest, and drivers that print as 0.0 say nothing.
 */
function topDrivers(signal: Signal) {
  return signal.drivers
    .filter((d) => Math.abs(d.contribution) >= 0.05)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, MAX_DRIVERS);
}

function signalCells(signal: Signal, locale: EmailLocale, classNames: Map<string, string>) {
  const c = copy[locale];
  const f = formatters(locale);
  const action =
    c.actions[signal.action] +
    (signal.reason === "forecast" ? "" : ` (${c.reasons[signal.reason]})`);
  const drivers = topDrivers(signal)
    .map((d) => `${d.rule} ${f.signed(d.contribution, 1)}`)
    .join(", ");
  return [
    cell(action),
    cell(signal.symbol),
    cell(classNames.get(signal.class) ?? (signal.class || "—")),
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
  const f = formatters(locale);
  const link = linkBlock(locale, options.baseUrl);
  const foot = footer(locale, [
    ...snapshot.books.map((b) => b.configHash),
    options.configHash ?? "",
  ]);
  const text: string[] = [subject, ""];
  // The disclaimer, hash and link also go above the order tables, so a client
  // that clips a long message still shows them.
  const html: string[] = [
    `<h1 style="${style.h1}">${escapeHtml(subject)}</h1>`,
    `<p style="${style.muted}">${escapeHtml(c.decided(snapshot.asOf))}</p>`,
    `<p style="${style.notice}">${foot.html}<br>${link.anchor}</p>`,
  ];
  text.push(c.decided(snapshot.asOf), "");
  for (const book of snapshot.books) {
    const title = `${book.name[locale]} · ${book.asOf}`;
    html.push(`<h2 style="${style.h2}">${escapeHtml(title)}</h2>`);
    text.push(title);
    if (book.signals.length) {
      let listed = book.signals;
      if (listed.length > DIGEST_MAX_ORDERS) {
        listed = [...listed]
          .sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional))
          .slice(0, DIGEST_MAX_ORDERS);
        const byAction = actionOrder.flatMap((action) => {
          const n = book.signals.filter((s) => s.action === action).length;
          return n ? [`${c.actions[action]} ${f.int(n)}`] : [];
        });
        const summary = [
          c.orderCounts(f.int(book.signals.length), byAction.join(" · ")),
          c.largest(f.int(listed.length), f.int(book.signals.length - listed.length)),
        ];
        html.push(`<p style="${style.muted}">${summary.map(escapeHtml).join("<br>")}</p>`);
        text.push(...summary);
      }
      // A snapshot without class names still renders, showing the class ids.
      const classNames = new Map((book.classes ?? []).map((k) => [k.id, k.name]));
      const rows = listed.map((s) => signalCells(s, locale, classNames));
      html.push(htmlTable(c.columns, rows, [false, false, false, true, true, true, true, false]));
      text.push(c.columns.join(" | "));
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
  html.push(link.html);
  text.push(link.text, "", foot.text);
  return { subject, text: text.join("\n"), html: page(locale, html.join(""), foot.html) };
}

/**
 * One warning in the email locale. Details are locale-neutral (see
 * BacktestWarning); anything that does not parse is shown as sent.
 */
function warningText(warning: BacktestWarning, locale: EmailLocale) {
  const c = copy[locale];
  const f = formatters(locale);
  const items = warning.detail.split(", ").filter(Boolean);
  const number = (value: string | undefined) => {
    const n = value?.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  };
  let detail = warning.detail;
  switch (warning.code) {
    case "forecast_scale": {
      const gated = items
        .map((item) => item.split(" ")[0])
        .filter((id) => signGatedRules.has(id as RuleId));
      detail =
        items
          .map((item) => {
            const [id, value] = item.split(" ");
            const n = number(value);
            return n === null ? item : `${id} ${f.num(n, 1)}`;
          })
          .join(", ") + (gated.length ? c.gateOpen(gated.join(c.listSeparator)) : "");
      break;
    }
    case "cost_budget": {
      const [cost, sharpe] = warning.detail.split("/").map(number);
      if (cost != null && sharpe != null) detail = c.costBudget(f.num(cost), f.num(sharpe));
      break;
    }
    case "short_window": {
      const n = number(warning.detail);
      if (n !== null) detail = c.sessions(f.int(n));
      break;
    }
    case "history_trimmed":
    case "price_jumps":
      detail = items
        .map((item) => {
          const move = /^(\S+) (\d{4}-\d{2}-\d{2}) ([+-]?\d+(?:\.\d+)?)%$/.exec(item);
          if (move) return `${move[1]} ${move[2]} ${f.pct(Number(move[3]), 1, true)}`;
          const more = /^… \+(\d+)$/.exec(item);
          return more ? c.more(f.int(Number(more[1]))) : item;
        })
        .join(", ");
      break;
    case "family_detracts":
      detail = items
        .map((id) =>
          Object.hasOwn(familyLabels, id) ? familyLabels[id as RuleFamily][locale] : id,
        )
        .join(c.listSeparator);
      break;
  }
  return `${c.warningCodes[warning.code] ?? warning.code}: ${detail}`;
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
    text.push(c.runColumns.join(" | "));
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
      text.push("", c.familyColumns.join(" | "));
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
    const warnings = book.warnings.map((w) => warningText(w, locale));
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
