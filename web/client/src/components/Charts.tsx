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
  onPointClick
}: {
  labels: string[];
  values: number[];
  height?: number;
  onPointClick?: (label: string) => void;
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
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksLimit: 7 } } },
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
  onBarClick
}: {
  labels: string[];
  values: number[];
  height?: number;
  label?: string;
  onBarClick?: (label: string) => void;
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
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true }, x: { ticks: { autoSkip: true, maxTicksLimit: 6 } } },
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
