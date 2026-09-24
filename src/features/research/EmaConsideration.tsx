import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, X } from "lucide-react";
import { useLocale } from "../../shared/locale";

export function EmaConsideration() {
  const { t, locale } = useLocale();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  const sections = [
    [
      t("What this model asks", "这个模型在研究什么"),
      t(
        "Does a pullback toward EMA200 tend to be followed by a rebound? Separate the existence and persistence of a rebound from the outcome of holding for a fixed period. These are historical observations, not live trades or a buy signal.",
        "价格回落到 EMA200 附近后，是否更容易反弹？把“有没有反弹、反弹能维持多久”与“固定持有期赚亏多少”分开看。这里是历史观察，不是实盘交易记录，也不直接构成买入信号。",
      ),
    ],
    [
      t("A zone, not an exact price", "用接触区域，而非精确碰线"),
      t(
        "The primary band is ±3%. A candidate requires the previous close above previous EMA ×1.03 and today's low at or below that upper boundary. Price may enter the band, undercut it, or gap entirely below it: failures stay in the sample. The previous EMA is known before the session. ±3% is a preset convention, not an optimized threshold. The ±1% / ±3% / ±5% comparison changes the whole event and background definition; samples therefore differ. Do not pick whichever band looks best after observing its returns.",
        "主模型使用 ±3% 区域：前日收盘必须高于前日 EMA ×1.03，当日最低价进入上边界或更低，即识别为回踩候选。允许下穿甚至直接跳空到区域下方，失败案例不能被筛掉。参考前日 EMA，避免使用盘中尚未知的均线。±3% 是预先指定的参数，不是验证过的最优值。±1%／±3%／±5% 会同时改变事件和背景样本定义，因此样本不同；不要看完收益后只挑表现最好的区间。",
      ),
    ],
    [
      t("One pullback episode", "连续下探合并为一次"),
      t(
        "After a candidate, no event or background observation is collected for 20 sessions. A new observation also requires three consecutive completed closes above the upper band. A prolonged decline without recovery remains one episode, not repeated buying opportunities.",
        "首次候选出现后，20 个交易日内不再采集事件或背景观察；重新采样还要求连续三个已完成交易日收盘站上接触带上沿。持续下跌、尚未恢复的同一段走势不会被重复记为多个买入机会。",
      ),
    ],
    [
      t(
        "Describe the outcome without selecting winners",
        "保留失败，事后描述形态",
      ),
      t(
        "Each event gets a label only after its 20-session window matures. Sustained weakness: the last three closes are below their prior EMA lower band; this takes priority. Reclaimed: at some point a low crossed below its prior EMA and a close subsequently (or that day) recovered to that EMA. Near: no low crossed below EMA. Other undercuts are mixed. These labels describe the observed path; they are not information available at the entry and never filter the primary test.",
        "事件的 20 日窗口完成后才标注形态。持续走弱：最后三日收盘均低于各自前日 EMA 的下边界，优先归为此类。曾跌破收回：期间最低价跌破当日前日 EMA，并曾在同日或随后收盘收回该日参考 EMA。仅附近回踩：窗口内未跌破 EMA。其余下穿归为反复／未收回。标签是事后描述，入场时并不知道；主检验不会只挑成功的形态。",
      ),
    ],
    [
      t("Touch versus confirmed bottom", "首次回踩与底部确认分开"),
      t(
        "The main study enters at the next open after the first candidate. Separately, track the lowest low from that candidate; a lower low restarts the clock. The first three subsequent sessions without a new low, within 20 sessions of the candidate, form a confirmation. Confirmation-based returns start at the next open after confirmation, never at the earlier low. This can still be a false bottom. Confirmation samples are a different, selected cohort, so their returns do not prove that waiting improves the same trade.",
        "主模型从首次回踩后的次日开盘开始计算。另设确认口径：从候选日跟踪最低价，创新低则重新计时；候选后 20 日内首次连续三个后续交易日未创新低，视为一次确认。确认收益从确认日之后的次日开盘计算，绝不倒回最低点假设买入。确认仍可能是假底；确认样本与首次回踩样本不同，不能仅凭两者均值高低就证明等待确认更优。",
      ),
    ],
    [
      t(
        "Endpoint return and average floating return",
        "终点收益与区间平均浮盈",
      ),
      t(
        "Endpoint return at h sessions = close at t+h / entry open at t+1 −1. Average floating return = the arithmetic mean of each daily close / that same entry open −1 over sessions 1…h. It describes persistence above or below entry, not the average daily change, an annualized return, or a realized exit. Show 5/10/20 sessions for both. For evaluating a fixed holding rule, endpoint return is primary; average floating return supplements it.",
        "h 日终点收益 = t+h 日收盘 ÷ t+1 日入场开盘 −1。区间平均浮盈 = 第 1 至 h 日各自收盘相对同一个入场价的收益，再取算术平均。它描述这段时间整体位于入场价上方还是下方，不是平均每日涨跌幅、年化收益或实际卖出收益。两者均展示 5／10／20 日窗口；评价固定持有规则时以终点收益为主，平均浮盈为辅。",
      ),
    ],
    [
      t("Rebound opportunity and downside", "反弹机会与过程风险"),
      t(
        "Maximum gain uses the highest daily high after entry; maximum loss uses the lowest daily low, both relative to entry, bounded by zero. They are maximum favorable/adverse excursions, not peak-to-trough drawdown or achievable trading profits. Tables show their means across events. The preset +5% target is hit when a daily high reaches entry ×1.05. Hit rate uses all fully observed windows; median time uses hit events only. Daily bars cannot tell whether a high or low occurred first, so there is no implied stop-loss or take-profit strategy.",
        "最大上涨用入场后区间最高价相对入场价计算，最低为 0；最大下跌用区间最低价相对入场价计算，最高为 0。它们是相对入场价的最大有利／不利波动，不是峰谷回撤，也不是可实现的交易利润。表格展示各事件这些数值的平均值。预设 +5% 目标：某日最高价达到入场价 ×1.05 即为命中。发生率以所有完整窗口为分母，到达用时的中位数只统计命中事件。日线无法判断当天最高价和最低价的先后，不能据此假设止盈止损成交。",
      ),
    ],
    [
      t(
        "Why both matter · hypothetical example",
        "为什么两者都要看 · 假设例子",
      ),
      t(
        "Two trades can both finish day 20 at +5%. One may stay profitable throughout; the other may fall 15% and recover only at the end. The endpoint is identical but the path and risk are different. To judge rebound tendency, read average floating return, +5% hit rate, time to hit and maximum loss together. A high hit rate alone may conceal large losses in the failures.",
        "两笔交易第 20 天都涨 5%：一种可能全程保持盈利，另一种可能先跌 15%，最后才反弹。终点相同，过程与风险却不同。判断反弹倾向时，将平均浮盈、+5% 发生率、用时和最大下跌一起看；高命中率也可能掩盖少数失败事件的大额亏损。",
      ),
    ],
    [
      t("Evidence, comparators and uncertainty", "证据、对照与不确定性"),
      t(
        "Only ±3% and the 20-session endpoint are the primary test. Background days have the same prior-close-above-band condition, no touch, and are outside the episode exclusion. r is point-biserial Pearson correlation of event (1/0) with endpoint return; advantage is the difference of group means. We use 1,000 moving-block bootstrap resamples of 42 calendar-session slots, including ineligible slots, for an approximate 95% interval. At least 12 mature events, 252 background days, nonzero variation and 950 valid resamples are required. Positive evidence also requires positive mean event return and positive advantage. Other windows, path measures, labels, confirmations and bands are descriptive, without separate significance claims.",
        "仅 ±3% 下的 20 日终点收益作为主检验。背景日同样要求前收盘在接触带上方、当日未触碰且不在事件排除期。r 为事件标记（1／0）与终点收益的点二列 Pearson 相关系数；优势为两组均值差。用 1000 次、每块 42 个交易日的移动分块重采样（包含不合格日空位）估计近似 95% 区间。至少需要 12 次成熟事件、252 个背景日、非零变异及 950 次有效重采样。正向证据还要求事件平均收益和收益优势均为正。其他窗口、路径指标、形态、确认及区间对比均为描述性结果，不单独宣称显著。",
      ),
    ],
    [
      t("Limits and missing data", "限制与缺失数据"),
      t(
        "EMA200 starts with the first 200 closes' simple mean, then updates with 2/201 weighting. Current split-adjusted history can be revised; finite history affects initialization. Incomplete windows and invalid entry prices are missing, never zero or failure. Returns exclude costs and reinvested dividends. Market drift, overlapping observations, regime changes, rare events and repeated testing can mislead; a block bootstrap does not make observations independent. No causality or out-of-sample validation is established. This model is not included in the buy/sell score. Old reports must explicitly recalculate v2; doing so uses market history, not an LLM.",
        "EMA200 先以 200 个收盘价的均值初始化，再按 2/201 权重递推。当前拆股调整历史可能被修订，有限历史影响初始化。未完成窗口和无效入场价留空，绝不当作零收益或失败。收益不含费用和分红再投资。市场漂移、重叠观察、环境变化、稀少事件和反复检验都可能误导；分块重采样不保证观察独立。尚未证明因果或完成样本外验证，此模型不加入买卖决策分数。旧报告需明确补算 v2；补算只用历史行情，不调用 LLM。",
      ),
    ],
  ];
  return (
    <>
      <button
        ref={trigger}
        className="ema-consideration-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          dialog.current?.showModal();
          const content = dialog.current?.querySelector(
            ".ema-consideration-content",
          );
          if (content) content.scrollTop = 0;
          setOpen(true);
        }}
      >
        <BookOpen size={16} aria-hidden="true" />
        {t("Consideration", "Consideration · 模型说明")}
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          id={id}
          className="ema-consideration-drawer"
          aria-labelledby={`${id}-title`}
          aria-modal="true"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const items = event.currentTarget.querySelectorAll<HTMLElement>(
              'button, a[href], [tabindex="0"]',
            );
            const first = items[0],
              last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          lang={locale === "zh" ? "zh-CN" : "en"}
          onClose={() => {
            if (dialog.current?.open) return;
            setOpen(false);
            trigger.current?.focus();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              const b = e.currentTarget.getBoundingClientRect();
              if (
                e.clientX < b.left ||
                e.clientX > b.right ||
                e.clientY < b.top ||
                e.clientY > b.bottom
              )
                dialog.current?.close();
            }
          }}
        >
          <header>
            <div>
              <p className="eyebrow">EMA200 · v2</p>
              <h2 id={`${id}-title`}>{t("Consideration", "模型说明与考量")}</h2>
            </div>
            <button
              autoFocus
              aria-label={t("Close considerations", "关闭模型说明")}
              onClick={() => dialog.current?.close()}
            >
              <X aria-hidden="true" size={22} />
            </button>
          </header>
          <div className="ema-consideration-content">
            {sections.map(([title, body]) => (
              <section key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </section>
            ))}
            <p className="ema-consideration-sources">
              <a
                href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/ema"
                target="_blank"
                rel="noreferrer"
              >
                Fidelity · EMA
              </a>
              <a
                href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pointbiserialr.html"
                target="_blank"
                rel="noreferrer"
              >
                SciPy · r
              </a>
              <a
                href="https://otexts.com/fpp3/bootstrap.html"
                target="_blank"
                rel="noreferrer"
              >
                FPP3 · bootstrap
              </a>
              <a
                href="https://www.cfainstitute.org/insights/articles/good-bad-and-ugly-of-bias-in-ai"
                target="_blank"
                rel="noreferrer"
              >
                CFA Institute · {t("Look-ahead bias", "前视偏差")}
              </a>
            </p>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
