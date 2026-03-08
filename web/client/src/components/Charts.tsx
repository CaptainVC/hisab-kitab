import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend);

export function DailyLineChart({
  labels,
  values,
  height = 180,
  onPointClick,
  formatY
}: {
  labels: string[];
  values: number[];
  height?: number;
  onPointClick?: (label: string) => void;
  formatY?: (v: number) => string;
}) {
  return (
    <Line
      height={height}
      data={{
        labels,
        datasets: [
          {
            label: 'Expense',
            data: values,
            borderColor: '#DAA520',
            backgroundColor: 'rgba(218, 165, 32, 0.12)',
            tension: 0.25,
            pointRadius: 1.5
          }
        ]
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = Number(ctx.parsed?.y ?? 0);
                return formatY ? formatY(v) : String(v);
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: 'rgba(255,255,255,0.65)',
              callback: (val) => {
                const v = Number(val);
                return formatY ? formatY(v) : String(val);
              }
            },
            grid: { color: 'rgba(255,255,255,0.06)' }
          },
          x: {
            ticks: { maxTicksLimit: 7, color: 'rgba(255,255,255,0.55)' },
            grid: { display: false }
          }
        },
        onClick: (_evt, elements, chart) => {
          if (!onPointClick) return;
          const el = elements?.[0];
          if (!el) return;
          const idx = (el as any).index as number;
          const lbl = (chart?.data?.labels?.[idx] as any) ?? '';
          if (typeof lbl === 'string' && lbl) onPointClick(lbl);
        }
      }}
    />
  );
}

export function CategoryDoughnut({
  labels,
  values,
  onSliceClick,
  height = 180
}: {
  labels: string[];
  values: number[];
  onSliceClick?: (label: string) => void;
  height?: number;
}) {
  return (
    <Doughnut
      height={height}
      data={{
        labels,
        datasets: [
          {
            label: 'Spend',
            data: values,
            backgroundColor: [
              '#8E4585', // plum
              '#DAA520', // goldenrod
              '#2E6F40', // forest
              '#660033', // burgundy
              // repeats w/ slight variations for extra slices
              '#A05A99',
              '#E3B33D',
              '#3C8250',
              '#7A0040',
              '#7B3B76',
              '#C9961C',
              '#255D35',
              '#540029'
            ]
          }
        ]
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        onClick: (_evt, elements, chart) => {
          if (!onSliceClick) return;
          const el = elements?.[0];
          if (!el) return;
          const idx = (el as any).index as number;
          const lbl = (chart?.data?.labels?.[idx] as any) ?? '';
          if (typeof lbl === 'string' && lbl) onSliceClick(lbl);
        }
      }}
    />
  );
}

export function SimpleBarChart({
  labels,
  values,
  height = 180,
  label = 'Amount',
  onBarClick,
  indexAxis = 'x',
  formatValue,
  tickMax = 8
}: {
  labels: string[];
  values: number[];
  height?: number;
  label?: string;
  onBarClick?: (label: string) => void;
  indexAxis?: 'x' | 'y';
  formatValue?: (v: number) => string;
  tickMax?: number;
}) {
  return (
    <Bar
      height={height}
      data={{
        labels,
        datasets: [
          {
            label,
            data: values,
            backgroundColor: 'rgba(46, 111, 64, 0.35)',
            borderColor: 'rgba(46, 111, 64, 0.9)',
            borderWidth: 1
          }
        ]
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        indexAxis,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = Number(ctx.parsed?.[indexAxis === 'y' ? 'x' : 'y'] ?? 0);
                return formatValue ? formatValue(v) : String(v);
              }
            }
          }
        },
        scales:
          indexAxis === 'y'
            ? {
                x: {
                  beginAtZero: true,
                  ticks: {
                    color: 'rgba(255,255,255,0.65)',
                    callback: (val) => {
                      const v = Number(val);
                      return formatValue ? formatValue(v) : String(val);
                    }
                  },
                  grid: { color: 'rgba(255,255,255,0.06)' }
                },
                y: {
                  ticks: { color: 'rgba(255,255,255,0.60)', autoSkip: true, maxTicksLimit: tickMax },
                  grid: { display: false }
                }
              }
            : {
                y: {
                  beginAtZero: true,
                  ticks: {
                    color: 'rgba(255,255,255,0.65)',
                    callback: (val) => {
                      const v = Number(val);
                      return formatValue ? formatValue(v) : String(val);
                    }
                  },
                  grid: { color: 'rgba(255,255,255,0.06)' }
                },
                x: {
                  ticks: {
                    color: 'rgba(255,255,255,0.60)',
                    autoSkip: true,
                    maxTicksLimit: tickMax,
                    maxRotation: 30,
                    minRotation: 0
                  },
                  grid: { display: false }
                }
              },
        onClick: (_evt, elements, chart) => {
          if (!onBarClick) return;
          const el = elements?.[0];
          if (!el) return;
          const idx = (el as any).index as number;
          const lbl = (chart?.data?.labels?.[idx] as any) ?? '';
          if (typeof lbl === 'string' && lbl) onBarClick(lbl);
        }
      }}
    />
  );
}
