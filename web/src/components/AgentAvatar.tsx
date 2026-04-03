import { useEffect, useState } from "react";
import { BASE_URL } from "../lib/api";

interface AgentAvatarProps {
  /** Key for `/api/agents/:name/avatar` (agent id, `default`, or `user`) */
  name: string;
  /** Display string for initials / hash color when images fail */
  label?: string;
  /** Remote image from agent config (tried before server avatar route) */
  imageUrl?: string | null;
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

export function AgentAvatar({
  name,
  label,
  imageUrl,
  className = "w-6 h-6 rounded-md",
}: AgentAvatarProps) {
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [apiFailed, setApiFailed] = useState(false);
  const initialSource = label ?? name;
  const initialChar = initialSource.charAt(0) || "?";

  useEffect(() => {
    setRemoteFailed(false);
    setApiFailed(false);
  }, [name, imageUrl]);

  if (imageUrl && !remoteFailed) {
    return (
      <img
        src={imageUrl}
        alt={initialSource}
        className={`object-cover shrink-0 bg-muted/30 ${className}`}
        onError={() => setRemoteFailed(true)}
      />
    );
  }

  if (!apiFailed) {
    return (
      <img
        src={`${BASE_URL}/api/agents/${encodeURIComponent(name)}/avatar`}
        alt={initialSource}
        className={`object-cover shrink-0 bg-muted/30 ${className}`}
        onError={() => setApiFailed(true)}
      />
    );
  }

  const colorClass = getColorForName(initialSource);
  return (
    <div
      className={`flex items-center justify-center uppercase font-bold shrink-0 ${colorClass} ${className}`}
      style={{ fontSize: "0.6em" }}
    >
      {initialChar}
    </div>
  );
}
