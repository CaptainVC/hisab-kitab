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

export function DailyLineChart({ labels, values, height = 180 }: { labels: string[]; values: number[]; height?: number }) {
  return (
    <Line
      height={height}
      data={{
        labels,
        datasets: [
          {
            label: 'Expense',
            data: values,
            borderColor: 'rgb(148, 163, 184)',
            backgroundColor: 'rgba(148, 163, 184, 0.15)',
            tension: 0.25,
            pointRadius: 1.5
          }
        ]
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksLimit: 7 } } }
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
              '#2563eb', // blue
              '#7c3aed', // violet
              '#059669', // emerald
              '#d97706', // amber
              '#dc2626', // red
              '#0891b2', // cyan
              '#db2777', // pink
              '#16a34a', // green
              '#9333ea', // purple
              '#ea580c', // orange
              '#64748b', // slate
              '#c026d3', // fuchsia
              '#0f766e', // teal
              '#ca8a04', // yellow
              '#0284c7' // sky
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
  label = 'Amount'
}: {
  labels: string[];
  values: number[];
  height?: number;
  label?: string;
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
            backgroundColor: 'rgba(148, 163, 184, 0.35)',
            borderColor: 'rgba(148, 163, 184, 0.9)',
            borderWidth: 1
          }
        ]
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true }, x: { ticks: { autoSkip: true, maxTicksLimit: 6 } } }
      }}
    />
  );
}
