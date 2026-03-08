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
              '#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb7185',
              '#22d3ee', '#f472b6', '#4ade80', '#c084fc', '#f97316',
              '#94a3b8', '#e879f9', '#2dd4bf', '#facc15', '#38bdf8'
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
