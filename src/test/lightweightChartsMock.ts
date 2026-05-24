import { vi } from "vitest";

export const CandlestickSeries = Symbol("CandlestickSeries");
export const LineSeries = Symbol("LineSeries");

function createSeries() {
  return {
    setData: vi.fn(),
  };
}

function createMockChart() {
  const timeScaleApi = {
    fitContent: vi.fn(),
  };

  return {
    addSeries: vi.fn(() => createSeries()),
    addLineSeries: vi.fn(() => createSeries()),
    addCandlestickSeries: vi.fn(() => createSeries()),
    addHistogramSeries: vi.fn(() => createSeries()),
    remove: vi.fn(),
    resize: vi.fn(),
    timeScale: vi.fn(() => timeScaleApi),
  };
}

const createdCharts: ReturnType<typeof createMockChart>[] = [];

export function createChart() {
  const chart = createMockChart();
  createdCharts.push(chart);

  return chart;
}

export function getCreatedCharts() {
  return createdCharts;
}

export function resetLightweightChartsMock() {
  createdCharts.length = 0;
}
