import { useState } from "react";
import { BASE_URL } from "../lib/api";

interface AgentAvatarProps {
  name: string;
  className?: string;
}

const colors = [
  "bg-red-500/10 text-red-500",
  "bg-orange-500/10 text-orange-500",
  "bg-amber-500/10 text-amber-500",
  "bg-green-500/10 text-green-500",
  "bg-emerald-500/10 text-emerald-500",
  "bg-teal-500/10 text-teal-500",
  "bg-cyan-500/10 text-cyan-500",
  "bg-sky-500/10 text-sky-500",
  "bg-blue-500/10 text-blue-500",
  "bg-indigo-500/10 text-indigo-500",
  "bg-violet-500/10 text-violet-500",
  "bg-purple-500/10 text-purple-500",
  "bg-fuchsia-500/10 text-fuchsia-500",
  "bg-pink-500/10 text-pink-500",
  "bg-rose-500/10 text-rose-500",
];

function getColorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function AgentAvatar({ name, className = "w-6 h-6 rounded-sm" }: AgentAvatarProps) {
  const [error, setError] = useState(false);

  if (error) {
    const colorClass = getColorForName(name);
    return (
      <div
        className={`flex items-center justify-center uppercase font-bold shrink-0 ${colorClass} ${className}`}
        style={{ fontSize: "0.6em" }}
      >
        {name.charAt(0)}
      </div>
    );
  }

  return (
    <img
      src={`${BASE_URL}/api/agents/${encodeURIComponent(name)}/avatar`}
      alt={name}
      className={`object-cover shrink-0 bg-muted/30 ${className}`}
      onError={() => setError(true)}
    />
  );
}