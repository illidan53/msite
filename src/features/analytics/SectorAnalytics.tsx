import { useState } from "react";
import { MetricHelp } from "../../shared/MetricHelp";
import {
  flowIntensity,
  freshness,
  netFlowMetric,
  persistence,
  relativeReturn,
} from "./metrics";

const sectors = [
  ["XLK", "信息技术"],
  ["XLF", "金融"],
  ["XLV", "医疗保健"],
  ["XLI", "工业"],
  ["XLY", "可选消费"],
  ["XLP", "必需消费"],
  ["XLE", "能源"],
  ["XLU", "公用事业"],
  ["XLB", "原材料"],
  ["XLRE", "房地产"],
  ["XLC", "通信服务"],
];

export function SectorAnalytics() {
  const [symbol, setSymbol] = useState("XLK");
  const sectorName = sectors.find(([ticker]) => ticker === symbol)?.[1];
  return (
    <section
      className="sector-analytics"
      aria-label="板块 ETF 资金流分析"
      lang="zh-CN"
    >
      <div className="analytics-intro">
        <div>
          <p className="eyebrow">读懂资金的变化</p>
          <h3>先看流向，再看持续性</h3>
          <p>
            观察 11 只板块 ETF 的净申赎。点击指标旁的 ⓘ，了解意义、公式和例子。
          </p>
        </div>
        <div className="analytics-status">
          <span>资金流数据待接入</span>
          <MetricHelp metric={freshness} />
        </div>
      </div>
      <div className="analytics-source-note" role="note">
        当前已接入价格与成交量，尚未接入 ETF 净申赎、历史基金规模和分红数据。
        以下为指标展示与说明；“—”表示待接入，不代表零流入。此页仅作数据观察，不提供买卖建议。
      </div>
      <div className="analytics-selection">
        <label htmlFor="analytics-sector">观察板块</label>
        <select
          id="analytics-sector"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
        >
          {sectors.map(([ticker, name]) => (
            <option key={ticker} value={ticker}>
              {name} · {ticker}
            </option>
          ))}
        </select>
        <span>
          {sectorName} / {symbol}
        </span>
      </div>
      <div className="analytics-metrics">
        {[5, 20, 60].map((days) => (
          <article className="analytics-metric" key={days}>
            <div className="metric-label">
              <h4>{days} 日累计净申赎</h4>
              <MetricHelp metric={netFlowMetric(days)} />
            </div>
            <p className="metric-pending" aria-label="待接入">
              —
            </p>
            <p>美元 · 最近 {days} 个完整交易日</p>
          </article>
        ))}
      </div>
      <div className="analytics-secondary">
        <article className="analytics-metric">
          <div className="metric-label">
            <h4>20 日流入强度</h4>
            <MetricHelp metric={flowIntensity} />
          </div>
          <p className="metric-pending" aria-label="待接入">
            —
          </p>
          <p>净申赎占期初基金规模的比例</p>
        </article>
        <article className="analytics-metric">
          <div className="metric-label">
            <h4>四周申赎持续性</h4>
            <MetricHelp metric={persistence} />
          </div>
          <div className="weekly-flow-placeholders">
            {["前四周", "前三周", "前两周", "上周"].map((label) => (
              <div key={label}>
                <span aria-label="待接入">—</span>
                <small>{label}</small>
              </div>
            ))}
          </div>
          <p>每个完整交易周的累计净申赎</p>
        </article>
        <article className="analytics-metric">
          <div className="metric-label">
            <h4>相对 SPY 总回报</h4>
            <MetricHelp metric={relativeReturn} />
          </div>
          <div className="return-placeholders">
            <p>
              <strong>—</strong>
              <span>20 日</span>
            </p>
            <p>
              <strong>—</strong>
              <span>60 日</span>
            </p>
          </div>
          <p>百分点 · 含分红再投资的数据待接入</p>
        </article>
      </div>
      <p className="analytics-footnote">
        观察范围：所选 ETF
        的申赎，不等于整个板块的全部资金；板块之间同时流入或流出，也不能证明是同一笔资金在转移。
      </p>
    </section>
  );
}
