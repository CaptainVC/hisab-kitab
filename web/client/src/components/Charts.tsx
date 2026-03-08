import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend);

export function DailyLineChart({ labels, values }: { labels: string[]; values: number[] }) {
  return (
    <Line
      data={{
        labels,
        datasets: [
          {
            label: 'Expense',
            data: values,
            borderColor: 'rgb(148, 163, 184)',
            backgroundColor: 'rgba(148, 163, 184, 0.2)',
            tension: 0.25,
            pointRadius: 2
          }
        ]
      }}
      options={{
        responsive: true,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } }
      }}
    />
  );
}

export function CategoryDoughnut({
  labels,
  values,
  onSliceClick
}: {
  labels: string[];
  values: number[];
  onSliceClick?: (label: string) => void;
}) {
  return (
    <Doughnut
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
              '#0284c7'  // sky
            ]
          }
        ]
      }}
      options={{
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
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
