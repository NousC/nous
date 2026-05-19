import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  ArrowUp,
  ArrowDown,
  AlertCircle,
  Download,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { format, parseISO } from "date-fns";

// Animation variants
const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }
};

// Page flip animation variants
const pageVariants = {
  enter: (direction: number) => ({
    rotateY: direction > 0 ? 90 : -90,
    opacity: 0,
    transformOrigin: direction > 0 ? "left center" : "right center"
  }),
  center: {
    rotateY: 0,
    opacity: 1,
    transformOrigin: "center center"
  },
  exit: (direction: number) => ({
    rotateY: direction < 0 ? 90 : -90,
    opacity: 0,
    transformOrigin: direction < 0 ? "left center" : "right center"
  })
};

interface Template {
  id: string;
  name: string;
  type: string;
}

interface DocumentWithAnalytics {
  id: string;
  name: string;
  template_id: string;
  created_at: string;
  has_share_token: boolean;
  company_name?: string | null;
  signing_status?: string;
  analytics: {
    total_views: number;
    total_downloads: number;
    average_time_spent_seconds: number;
    average_pages_viewed: number;
    completion_rate: number;
  };
}

interface AnalyticsData {
  summary: {
    total_documents_created: number;
    total_sent: number;
    total_views: number;
    total_downloads: number;
    average_view_time_seconds: number;
    average_completion_rate: number;
  };
  documents: DocumentWithAnalytics[];
  timeSeriesData: any[];
  flowMetrics?: {
    created: number;
    viewed: number;
    completed: number;
    closed: number;
    sent_to_viewed: number;
    viewed_to_completed: number;
    completed_to_closed?: number;
  };
}

interface ContactsAnalytics {
  totalContacts: number;
  closedDeals: number;
  closedDealValue: number;
  openDealsCount: number;
  pipelineValue: number;
  totalDealValue: number;
  industryBreakdown: { industry: string; count: number }[];
}

// Nous teal/green color palette
const COLORS = {
  created: "#94a3b8",
  sent: "#0d9488",    // Teal 600
  viewed: "#14b8a6",  // Teal 500
  completed: "#10b981", // Emerald 500
  signed: "#059669",   // Emerald 600
};

const INDUSTRY_COLORS = [
  "#0d9488", // Teal
  "#10b981", // Emerald
  "#14b8a6", // Teal light
  "#059669", // Emerald dark
  "#5eead4", // Teal 300
  "#6ee7b7", // Emerald 300
  "#0f766e", // Teal 700
  "#047857", // Emerald 700
];

const AdvancedAnalytics = () => {
  const navigate = useNavigate();
  const { userData, session } = useAuth();

  // Reporting is proposals-only
  const selectedDocType = "proposal";
  const selectedTypeSupportsSignng = true; // proposals always support signing

  // Page state (0 = front/analytics, 1 = back/metrics)
  const [currentPage, setCurrentPage] = useState(0);
  const [pageDirection, setPageDirection] = useState(0);

  // Filters
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>("all");
  const [dateRange, setDateRange] = useState<"7" | "30" | "90" | "all">("30");

  // Data
  const [templates, setTemplates] = useState<Template[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [contactsAnalytics, setContactsAnalytics] = useState<ContactsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Sorting
  const [sortColumn, setSortColumn] = useState<"name" | "views" | "time" | "completion" | "date" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Load templates by type
  const loadTemplates = useCallback(async () => {
    if (!userData?.workspace?.id || !session?.access_token || !selectedDocType) return;
    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/workspaces/${userData.workspace.id}/templates?type=${selectedDocType}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error("Error loading templates:", error);
    } finally {
      setLoading(false);
    }
  }, [userData?.workspace?.id, session?.access_token, selectedDocType]);

  // Load contacts analytics for closed deals and industry breakdown
  const loadContactsAnalytics = useCallback(async () => {
    if (!userData?.workspace?.id || !session?.access_token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/workspace/analytics/contacts?workspaceId=${userData.workspace.id}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        setContactsAnalytics(data);
      }
    } catch (error) {
      console.error("Error loading contacts analytics:", error);
    }
  }, [userData?.workspace?.id, session?.access_token]);

  // Load analytics data
  const loadAnalytics = useCallback(async () => {
    if (!userData?.workspace?.id || !session?.access_token || !selectedDocType) return;
    setAnalyticsLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      let startDate: Date;
      if (dateRange === "all") {
        startDate = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000);
      } else {
        startDate = new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000);
      }
      const endDate = new Date();

      const params = new URLSearchParams({
        workspaceId: userData.workspace.id,
        documentType: selectedDocType,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      if (selectedTemplateName !== "all") {
        params.append("templateId", selectedTemplateName);
      }

      const response = await fetch(
        `${apiUrl}/api/workspace/analytics/advanced?${params.toString()}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );

      if (response.ok) {
        const data: AnalyticsData = await response.json();
        setAnalytics(data);
      }
    } catch (error) {
      console.error("Error loading analytics:", error);
      setAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [userData?.workspace?.id, session?.access_token, selectedDocType, selectedTemplateName, dateRange]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    loadAnalytics();
    loadContactsAnalytics();
  }, [loadAnalytics, loadContactsAnalytics]);

  // Sort and filter documents by date range
  const getSortedDocuments = () => {
    if (!analytics?.documents) return [];

    let docs = [...analytics.documents];
    if (dateRange !== "all") {
      const daysAgo = parseInt(dateRange);
      const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      docs = docs.filter(doc => new Date(doc.created_at) >= cutoffDate);
    }

    if (!sortColumn) return docs;

    return docs.sort((a, b) => {
      let aVal: any = 0;
      let bVal: any = 0;

      switch (sortColumn) {
        case "name":
          aVal = a.name;
          bVal = b.name;
          break;
        case "views":
          aVal = a.analytics.total_views;
          bVal = b.analytics.total_views;
          break;
        case "time":
          aVal = a.analytics.average_time_spent_seconds;
          bVal = b.analytics.average_time_spent_seconds;
          break;
        case "completion":
          aVal = a.analytics.completion_rate;
          bVal = b.analytics.completion_rate;
          break;
        case "date":
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          break;
      }

      if (typeof aVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
  };

  const sortedDocs = getSortedDocuments();

  // Get templates with documents
  const templatesWithDocs = templates.filter(t =>
    analytics?.documents.some(doc => doc.template_id === t.id)
  );

  // Download analytics as CSV
  const handleDownloadReport = () => {
    if (!analytics || !sortedDocs.length) {
      toast.error("No data to download");
      return;
    }

    const headers = ["Name", "Company", "Views", "Avg Time (min)", "Completion %", "Created Date"];
    const rows = sortedDocs.map(doc => [
      doc.name,
      doc.company_name || "",
      doc.analytics.total_views,
      Math.round(doc.analytics.average_time_spent_seconds / 60),
      doc.analytics.completion_rate,
      format(new Date(doc.created_at), "yyyy-MM-dd")
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `analytics-report-${selectedDocType}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success("Report downloaded successfully");
  };

  // Page navigation
  const goToPage = (page: number) => {
    setPageDirection(page > currentPage ? 1 : -1);
    setCurrentPage(page);
  };

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Status Distribution Bar Chart
  const DocumentFlow = ({ flow, supportsSigning }: { flow: any, supportsSigning: boolean }) => {
    if (!flow) return null;

    const stages = [
      { label: "Created", count: flow.currentCreated ?? 0, color: COLORS.created },
      { label: "Sent", count: flow.currentSent ?? 0, color: COLORS.sent },
      { label: "Viewed", count: flow.currentViewed ?? 0, color: COLORS.viewed },
    ];

    if (supportsSigning) {
      stages.push({ label: "Signed", count: flow.currentSigned ?? 0, color: COLORS.signed });
    }

    const maxCount = Math.max(...stages.map(s => s.count), 1);
    const MAX_BAR_HEIGHT = 110;

    return (
      <div className="h-full flex flex-col">
        {/* Bars */}
        <div className="flex items-end justify-around flex-1 px-4 pb-2 gap-4">
          {stages.map((stage, index) => {
            const barHeight = Math.max(8, (stage.count / maxCount) * MAX_BAR_HEIGHT);
            return (
              <div key={stage.label} className="flex flex-col items-center gap-1 min-w-0">
                <motion.span
                  className="text-xs font-semibold text-gray-700"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 + 0.2, duration: 0.3 }}
                >
                  {stage.count}
                </motion.span>
                <motion.div
                  className="w-10 rounded-t-md"
                  style={{ backgroundColor: stage.color }}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: barHeight, opacity: 1 }}
                  transition={{ delay: index * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            );
          })}
        </div>

        {/* Labels */}
        <div className="flex justify-around px-4 pb-1">
          {stages.map((stage, index) => (
            <motion.div
              key={stage.label}
              className="flex items-center gap-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: index * 0.08 + 0.4, duration: 0.3 }}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
              <span className="text-[10px] font-medium text-gray-500">{stage.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  // Industry Pie Chart Component
  const IndustryPieChart = ({ data }: { data: { industry: string; count: number }[] }) => {
    if (!data || data.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-gray-400 text-sm">
          No industry data
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col">
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={65}
              paddingAngle={2}
              dataKey="count"
              nameKey="industry"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={INDUSTRY_COLORS[index % INDUSTRY_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "white",
                border: "none",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                fontSize: "12px"
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {data.slice(0, 4).map((item, index) => (
            <div key={item.industry} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: INDUSTRY_COLORS[index % INDUSTRY_COLORS.length] }} />
              <span className="text-[10px] text-gray-500 truncate max-w-[60px]">{item.industry}</span>
            </div>
          ))}
          {data.length > 4 && (
            <span className="text-[10px] text-gray-400">+{data.length - 4} more</span>
          )}
        </div>
      </div>
    );
  };


  // Front Page - Analytics Dashboard
  const FrontPage = () => (
    <div className="space-y-4">
      {/* Top Row - 3 Cards: Pipeline Value, Closed Deals, Status Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Pipeline Value Card - 3/12 */}
        <motion.div variants={fadeInUp} transition={{ duration: 0.5 }} className="lg:col-span-3">
          <Card className="p-4 border border-gray-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-shadow duration-300 h-[265px]">
            <div className="mb-2">
              <h3 className="text-[13px] font-semibold text-gray-900">Pipeline Value</h3>
              <p className="text-[11px] text-gray-400">Open prospects</p>
            </div>
            <div className="flex flex-col items-center justify-center h-[160px]">
              <motion.div
                className="text-3xl font-bold text-teal-600 mb-1"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                {formatCurrency(contactsAnalytics?.pipelineValue ?? 0)}
              </motion.div>
              <motion.div
                className="text-[13px] text-gray-500 mt-1"
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.4 }}
              >
                {contactsAnalytics?.openDealsCount ?? 0} prospect{(contactsAnalytics?.openDealsCount ?? 0) !== 1 ? 's' : ''}
              </motion.div>
            </div>
          </Card>
        </motion.div>

        {/* Closed Deals Card - 3/12 */}
        <motion.div variants={fadeInUp} transition={{ duration: 0.5, delay: 0.1 }} className="lg:col-span-3">
          <Card className="p-4 border border-gray-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-shadow duration-300 h-[265px]">
            <div className="mb-2">
              <h3 className="text-[13px] font-semibold text-gray-900">Closed Deals</h3>
              <p className="text-[11px] text-gray-400">Signed clients</p>
            </div>
            <div className="flex flex-col items-center justify-center h-[160px]">
              <motion.div
                className="text-3xl font-bold text-teal-600 mb-1"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                {formatCurrency(contactsAnalytics?.closedDealValue ?? 0)}
              </motion.div>
              <motion.div
                className="text-[13px] text-gray-500 mt-1"
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.4 }}
              >
                {contactsAnalytics?.closedDeals ?? 0} client{(contactsAnalytics?.closedDeals ?? 0) !== 1 ? 's' : ''}
              </motion.div>
            </div>
          </Card>
        </motion.div>

        {/* Status Distribution Card - 6/12 */}
        <motion.div variants={fadeInUp} transition={{ duration: 0.5, delay: 0.2 }} className="lg:col-span-6">
          <Card className="p-4 border border-gray-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-shadow duration-300 h-[265px] overflow-hidden">
            <div className="mb-2">
              <h3 className="text-[13px] font-semibold text-gray-900">Status Distribution</h3>
              <p className="text-[11px] text-gray-400">Documents by current status</p>
            </div>
            <div className="h-[190px] overflow-hidden">
              <DocumentFlow flow={analytics?.flowMetrics} supportsSigning={selectedTypeSupportsSignng} />
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Bottom Row - Progress Over Time + # of Contacts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Progress Over Time - 3/5 Width */}
        <motion.div
          variants={fadeInUp}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="lg:col-span-3"
        >
          <Card className="p-4 border border-gray-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-shadow duration-300">
            <div className="mb-2">
              <h3 className="text-[13px] font-semibold text-gray-900">Progress Over Time</h3>
              <p className="text-[11px] text-gray-400">Document workflow trends</p>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={analytics?.timeSeriesData || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#e2e8f0"
                  tick={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }}
                  tickFormatter={(date) => format(parseISO(date), 'MMM d')}
                  dy={10}
                  axisLine={false}
                />
                <YAxis
                  stroke="#e2e8f0"
                  tick={{ fontSize: 11, fill: "#64748b", fontWeight: 500 }}
                  allowDecimals={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "none",
                    borderRadius: "10px",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    fontSize: "11px",
                    padding: "10px 14px"
                  }}
                />
                {analytics?.timeSeriesData?.some((d: any) => d.sent > 0) && (
                  <Line type="monotone" dataKey="sent" stroke={COLORS.sent} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} name="Sent" connectNulls />
                )}
                {analytics?.timeSeriesData?.some((d: any) => d.viewed > 0) && (
                  <Line type="monotone" dataKey="viewed" stroke={COLORS.viewed} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} name="Viewed" connectNulls />
                )}
                {selectedTypeSupportsSignng && analytics?.timeSeriesData?.some((d: any) => d.closed > 0) && (
                  <Line type="monotone" dataKey="closed" stroke={COLORS.signed} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} name="Signed" connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>

        {/* # of Contacts - 2/5 Width */}
        <motion.div
          variants={fadeInUp}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="lg:col-span-2"
        >
          <Card className="p-4 border border-gray-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-shadow duration-300 h-full">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-[13px] font-semibold text-gray-900"># of Contacts</h3>
                <p className="text-[11px] text-gray-400">By industry</p>
              </div>
              <span className="text-2xl font-bold text-gray-900">{contactsAnalytics?.totalContacts ?? 0}</span>
            </div>
            <div className="h-[220px]">
              <IndustryPieChart data={contactsAnalytics?.industryBreakdown || []} />
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );

  // Back Page - Document Metrics Table
  const BackPage = () => (
    <motion.div variants={fadeInUp} transition={{ duration: 0.5 }}>
      <Card className="p-6 border border-gray-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-shadow duration-300">
        <h2 className="text-[15px] font-semibold text-gray-900 mb-5">
          {selectedDocType.charAt(0).toUpperCase() + selectedDocType.slice(1)} Metrics
        </h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-100 bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="cursor-pointer hover:bg-gray-100/50 text-[13px] font-medium text-gray-600 rounded-l-lg transition-colors" onClick={() => { setSortColumn("name"); setSortDirection(sortDirection === "asc" ? "desc" : "asc"); }}>
                  <div className="flex items-center gap-1.5">
                    Name
                    {sortColumn === "name" && (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </div>
                </TableHead>
                <TableHead className="text-[13px] font-medium text-gray-600">Company</TableHead>
                <TableHead className="cursor-pointer hover:bg-gray-100/50 text-[13px] font-medium text-gray-600 transition-colors" onClick={() => { setSortColumn("views"); setSortDirection(sortDirection === "asc" ? "desc" : "asc"); }}>
                  <div className="flex items-center gap-1.5">
                    Views
                    {sortColumn === "views" && (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-gray-100/50 text-[13px] font-medium text-gray-600 transition-colors" onClick={() => { setSortColumn("time"); setSortDirection(sortDirection === "asc" ? "desc" : "asc"); }}>
                  <div className="flex items-center gap-1.5">
                    Time
                    {sortColumn === "time" && (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-gray-100/50 text-[13px] font-medium text-gray-600 transition-colors" onClick={() => { setSortColumn("completion"); setSortDirection(sortDirection === "asc" ? "desc" : "asc"); }}>
                  <div className="flex items-center gap-1.5">
                    Completion
                    {sortColumn === "completion" && (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-gray-100/50 text-[13px] font-medium text-gray-600 rounded-r-lg transition-colors" onClick={() => { setSortColumn("date"); setSortDirection(sortDirection === "asc" ? "desc" : "asc"); }}>
                  <div className="flex items-center gap-1.5">
                    Date
                    {sortColumn === "date" && (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedDocs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-gray-400 text-sm">
                    No documents found
                  </TableCell>
                </TableRow>
              ) : (
                sortedDocs.map((doc, index) => (
                  <motion.tr
                    key={doc.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.3 }}
                    className="border-gray-100 hover:bg-gray-50/50 transition-colors"
                  >
                    <TableCell className="font-medium text-[13px] text-gray-900">{doc.name}</TableCell>
                    <TableCell className="text-gray-500 text-[13px]">{doc.company_name || "—"}</TableCell>
                    <TableCell className="text-[13px] text-gray-700">{doc.analytics.total_views}</TableCell>
                    <TableCell className="text-[13px] text-gray-700">{Math.round(doc.analytics.average_time_spent_seconds / 60)}m</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[100px] overflow-hidden">
                          <motion.div
                            className="h-full bg-teal-500 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${doc.analytics.completion_rate}%` }}
                            transition={{ duration: 0.8, delay: index * 0.05, ease: "easeOut" }}
                          />
                        </div>
                        <span className="text-[12px] font-medium text-gray-600 w-8">{doc.analytics.completion_rate}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-500 text-[13px]">{format(new Date(doc.created_at), "MMM d")}</TableCell>
                  </motion.tr>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </motion.div>
  );

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-gray-50/50 to-white">
      {/* Header */}
      <motion.div
        className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="container mx-auto px-8 py-4 flex items-center gap-4">
          <div>
            <h1 className="text-[20px] font-semibold text-gray-900 tracking-[-0.01em]">Reporting</h1>
            <p className="text-[13px] text-gray-400 mt-0.5">Track document performance and engagement</p>
          </div>

          <div className="flex-1" />

          {/* Filters */}
          <motion.div
            className="flex items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            {/* Template Filter */}
            {templatesWithDocs.length > 0 && (
              <Select value={selectedTemplateName} onValueChange={setSelectedTemplateName}>
                <SelectTrigger className="w-[160px] bg-white border-gray-200/60 hover:border-gray-300 transition-colors rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-gray-200/60">
                  <SelectItem value="all">All Templates</SelectItem>
                  {templatesWithDocs.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Date Range Filter */}
            <Select value={dateRange} onValueChange={(val: any) => setDateRange(val)}>
              <SelectTrigger className="w-[130px] bg-white border-gray-200/60 hover:border-gray-300 transition-colors rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-gray-200/60">
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>

            {/* Download Button */}
            <button
              onClick={handleDownloadReport}
              disabled={analyticsLoading || !analytics?.documents?.length}
              className="p-2.5 hover:bg-gray-100 rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download Report"
            >
              <Download className="w-4.5 h-4.5 text-gray-600" />
            </button>
          </motion.div>
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-8 py-4">
          {analyticsLoading ? (
            <motion.div
              className="space-y-5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="h-[265px] bg-gray-50/80 rounded-2xl animate-pulse" />
                <div className="h-[265px] bg-gray-50/80 rounded-2xl animate-pulse" />
                <div className="h-[265px] bg-gray-50/80 rounded-2xl animate-pulse" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3 h-[260px] bg-gray-50/80 rounded-2xl animate-pulse" />
                <div className="lg:col-span-2 h-[260px] bg-gray-50/80 rounded-2xl animate-pulse" />
              </div>
            </motion.div>
          ) : analytics ? (
            <div className="relative" style={{ perspective: "1500px" }}>
              <AnimatePresence mode="wait" custom={pageDirection}>
                {currentPage === 0 ? (
                  <motion.div
                    key="front"
                    custom={pageDirection}
                    variants={pageVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <FrontPage />
                  </motion.div>
                ) : (
                  <motion.div
                    key="back"
                    custom={pageDirection}
                    variants={pageVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <BackPage />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Page Navigation */}
              <motion.div
                className="flex items-center justify-center gap-4 mt-5"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => goToPage(0)}
                  disabled={currentPage === 0}
                  className="h-9 px-4 gap-2 text-gray-600 hover:text-gray-900 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Analytics
                </Button>

                {/* Page Indicators */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => goToPage(0)}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${currentPage === 0 ? 'bg-teal-600 w-6' : 'bg-gray-300 hover:bg-gray-400'}`}
                  />
                  <button
                    onClick={() => goToPage(1)}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${currentPage === 1 ? 'bg-teal-600 w-6' : 'bg-gray-300 hover:bg-gray-400'}`}
                  />
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => goToPage(1)}
                  disabled={currentPage === 1}
                  className="h-9 px-4 gap-2 text-gray-600 hover:text-gray-900 disabled:opacity-40"
                >
                  Metrics
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </motion.div>
            </div>
          ) : (
            <motion.div
              className="p-16 text-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/30"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            >
              <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No data available</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvancedAnalytics;
