"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const PALETTE = ["#22C6DA", "#5AD3E2", "#8FDFEA", "#B7E9F1", "#D8F3F7"];

export function DomainChart({
  data, variant = "h",
}: {
  data: { name: string; value: number }[];
  variant?: "h" | "bar";
}) {
  const empty = data.every((d) => d.value === 0);
  if (empty) {
    return (
      <div className="h-[180px] flex items-center justify-center text-[14px] text-ink-faint">
        No data yet.
      </div>
    );
  }

  if (variant === "bar") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <XAxis
            dataKey="name" tickLine={false} axisLine={false}
            tick={{ fontSize: 12, fill: "#A8AEB6" }}
          />
          <YAxis
            tickLine={false} axisLine={false}
            tick={{ fontSize: 12, fill: "#A8AEB6" }} width={44}
          />
          <Tooltip cursor={{ fill: "#F7F8FA" }} />
          <Bar dataKey="value" name="Sent" fill="#22C6DA" radius={[4, 4, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category" dataKey="name" tickLine={false} axisLine={false}
          tick={{ fontSize: 13, fill: "#4A5058" }} width={82}
        />
        <Tooltip cursor={{ fill: "#F7F8FA" }} />
        <Bar dataKey="value" name="Contacts" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
