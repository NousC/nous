import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, Send, CheckCircle2, Lightbulb, ArrowRight } from "lucide-react";

interface Insight {
  id: string;
  type: "follow_up" | "nudge" | "success" | "tip";
  icon: string;
  message: string;
  action: { label: string; url: string };
}

const iconMap = {
  eye: Eye,
  send: Send,
  check: CheckCircle2,
  file: Lightbulb,
};

const dotColor = {
  follow_up: "bg-amber-400",
  nudge: "bg-blue-400",
  success: "bg-emerald-400",
  tip: "bg-teal-400",
};

export function InsightsPanel() {
  const navigate = useNavigate();
  const { userData, session } = useAuth();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const loadInsights = useCallback(async () => {
    if (!userData?.workspace?.id || !session?.access_token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/workspaces/${userData.workspace.id}/insights`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        setInsights(data.insights || []);
      }
    } catch (error) {
      console.error("Error loading insights:", error);
    } finally {
      setLoading(false);
    }
  }, [userData?.workspace?.id, session?.access_token]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  if (loading) return null;
  if (insights.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {insights.map((insight) => {
        const dot = dotColor[insight.type] || "bg-gray-400";

        return (
          <button
            key={insight.id}
            onClick={() => navigate(insight.action.url)}
            className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors text-left group"
          >
            <div className={`w-1.5 h-1.5 rounded-full ${dot} mt-[7px] flex-shrink-0`} />
            <span className="flex-1 text-xs text-gray-500 leading-relaxed">
              {insight.message}
            </span>
            <ArrowRight className="h-3 w-3 text-gray-300 group-hover:text-gray-500 mt-[3px] flex-shrink-0 transition-colors" />
          </button>
        );
      })}
    </div>
  );
}
