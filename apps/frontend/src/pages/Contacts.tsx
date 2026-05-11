import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Search,
  Plus,
  Users,
  ArrowLeft,
  FileText,
  Building2,
  Inbox,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ContactProfilePanel } from "@/components/contacts/ContactProfilePanel";
import { ContactDetailTabs } from "@/components/contacts/ContactDetailTabs";
import { ContactFormModal } from "@/components/contacts/ContactFormModal";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { format } from "date-fns";

interface Contact {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  company?: string;
  job_title?: string;
  notes?: string;
  total_documents_count: number;
  incoming_contacts_count: number;
  total_income?: number;
  total_income_source?: string;
  last_activity_at?: string;
  last_document_at?: string;
  stripe_customer_id?: string;
  created_at: string;
  deal_value?: number;
  deal_closed_at?: string;
  deal_sent_at?: string;
  status?: string;
  industry?: string;
  lead_source?: string;
  company_size?: string;
  keywords?: string;
}

// Animation variants
const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 }
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05
    }
  }
};

const Contacts = () => {
  const navigate = useNavigate();
  const { userData, session } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const workspaceId = userData?.workspace?.id;

  useEffect(() => {
    if (workspaceId) {
      loadContacts();
      loadUnreadCount();
    }
  }, [workspaceId]);

  const loadUnreadCount = async () => {
    if (!workspaceId || !session?.access_token) return;
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/notifications?workspaceId=${workspaceId}&limit=1`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (error) {
      console.error("Error loading unread count:", error);
    }
  };

  useEffect(() => {
    // Debounced search
    const timer = setTimeout(() => {
      if (workspaceId) {
        loadContacts();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadContacts = async () => {
    if (!workspaceId || !session?.access_token) return;

    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const params = new URLSearchParams({ workspaceId });
      if (search) {
        params.append("search", search);
      }

      const response = await fetch(`${apiUrl}/api/contacts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setContacts(data.contacts || []);
      }
    } catch (error) {
      console.error("Error loading contacts:", error);
      toast.error("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  };

  const handleAddContact = () => {
    setEditingContact(null);
    setFormModalOpen(true);
  };

  const handleEditContact = () => {
    if (selectedContact) {
      setEditingContact(selectedContact);
      setFormModalOpen(true);
    }
  };

  const handleDeleteContact = () => {
    if (selectedContact) {
      setContactToDelete(selectedContact);
      setDeleteDialogOpen(true);
    }
  };

  const confirmDelete = async () => {
    if (!contactToDelete || !session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/contacts/${contactToDelete.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        throw new Error("Failed to delete contact");
      }

      toast.success("Contact deleted");

      // Remove from list and clear selection
      setContacts((prev) => prev.filter((c) => c.id !== contactToDelete.id));
      if (selectedContact?.id === contactToDelete.id) {
        setSelectedContact(null);
      }
    } catch (error: any) {
      console.error("Error deleting contact:", error);
      toast.error(error.message || "Failed to delete contact");
    }
  };

  const handleFormSuccess = (contact: Contact) => {
    if (editingContact) {
      // Update existing
      setContacts((prev) =>
        prev.map((c) => (c.id === contact.id ? contact : c))
      );
      if (selectedContact?.id === contact.id) {
        setSelectedContact(contact);
      }
    } else {
      // Add new
      setContacts((prev) => [contact, ...prev]);
    }
  };

  const handleIncomeUpdate = async (income: number) => {
    if (!selectedContact || !session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/contacts/${selectedContact.id}/income`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ total_income: income })
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedContact(data.contact);
        setContacts((prev) =>
          prev.map((c) => (c.id === data.contact.id ? data.contact : c))
        );
        toast.success("Income updated");
      } else {
        toast.error("Failed to update income");
      }
    } catch (error) {
      console.error("Error updating income:", error);
      toast.error("Failed to update income");
    }
  };

  const getInitials = (contact: Contact) => {
    const parts = [contact.first_name?.[0], contact.last_name?.[0]].filter(Boolean);
    return parts.length > 0 ? parts.join("").toUpperCase() : contact.email[0].toUpperCase();
  };

  const getDisplayName = (contact: Contact) => {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    return name || contact.email;
  };

  const formatCurrency = (value?: number) => {
    if (!value) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Detail View - when a contact is selected
  if (selectedContact) {
    return (
      <div className="flex flex-col h-screen bg-gradient-to-b from-gray-50/50 to-white overflow-hidden scrollbar-hide">
        {/* Header */}
        <motion.div
          className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div className="container mx-auto px-8 py-4 flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedContact(null)}
              className="gap-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>

            <div className="h-5 w-px bg-gray-200" />

            <div>
              <h1 className="text-[18px] font-semibold text-gray-900 tracking-[-0.02em]">
                {getDisplayName(selectedContact)}
              </h1>
              <p className="text-xs text-gray-500">{selectedContact.email}</p>
            </div>

            <div className="flex-1" />
          </div>
        </motion.div>

        {/* Content - 1/3 Profile, 2/3 Tabs */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="container mx-auto px-8 py-4 h-full overflow-hidden">
            <div className="flex gap-5 h-full overflow-hidden">
              {/* Profile Panel - 1/3 */}
              <motion.div
                className="w-[310px] flex-shrink-0 overflow-hidden"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <ContactProfilePanel
                  contact={selectedContact}
                  onEdit={handleEditContact}
                  onDelete={handleDeleteContact}
                  onIncomeUpdate={handleIncomeUpdate}
                  onContactUpdate={(updatedContact) => {
                    setContacts((prev) =>
                      prev.map((c) => (c.id === updatedContact.id ? updatedContact : c))
                    );
                    setSelectedContact(updatedContact);
                  }}
                />
              </motion.div>

              {/* Detail Tabs - 2/3 */}
              <motion.div
                className="flex-1 h-full overflow-hidden"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              >
                <ContactDetailTabs
                  contactId={selectedContact.id}
                  workspaceId={workspaceId || ""}
                />
              </motion.div>
            </div>
          </div>
        </div>

        {/* Modals */}
        <ContactFormModal
          open={formModalOpen}
          onOpenChange={setFormModalOpen}
          contact={editingContact}
          workspaceId={workspaceId || ""}
          onSuccess={handleFormSuccess}
        />

        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={confirmDelete}
          title="Delete Contact"
          itemName={getDisplayName(selectedContact)}
        />
      </div>
    );
  }

  // List View - contacts in rows
  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-gray-50/50 to-white">
      {/* Header */}
      <motion.div
        className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="container mx-auto px-8 py-5 flex items-center gap-4">
          <div>
            <h1 className="text-[22px] font-semibold text-gray-900 tracking-[-0.02em]">Contacts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage your clients and leads</p>
          </div>

          <div className="flex-1" />

          {/* Filters & Actions */}
          <motion.div
            className="flex items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            {/* Inbox Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/inbox")}
              className="relative gap-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
            >
              <Inbox className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Button>

            {/* Search */}
            <div className="relative w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 bg-white border-gray-200/60 hover:border-gray-300 transition-colors rounded-xl"
              />
            </div>

            <Button onClick={handleAddContact} className="gap-2 rounded-xl">
              <Plus className="h-4 w-4" />
              Add Contact
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-8 py-6">
          {loading ? (
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-[60px] bg-gray-50/80 rounded-xl animate-pulse" />
              ))}
            </motion.div>
          ) : contacts.length === 0 ? (
            <motion.div
              className="flex flex-col items-center justify-center min-h-[400px] rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/50"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            >
              <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200/60 shadow-sm flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-gray-400" strokeWidth={1.5} />
              </div>
              <h2 className="text-[15px] font-medium text-gray-900 mb-1">No contacts yet</h2>
              <p className="text-sm text-gray-400 mb-5">Add your first contact to get started</p>
              <Button onClick={handleAddContact} className="gap-2 rounded-xl">
                <Plus className="h-4 w-4" />
                Add Contact
              </Button>
            </motion.div>
          ) : (
            <motion.div
              className="border border-gray-200/50 rounded-2xl bg-white overflow-hidden"
              variants={fadeInUp}
              initial="initial"
              animate="animate"
              transition={{ duration: 0.5 }}
            >
              {/* Table Header */}
              <div className="grid grid-cols-[1fr_80px_1fr_100px_100px_100px] gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50/50">
                <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wider">Name</span>
                <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wider">Status</span>
                <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wider">Company</span>
                <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wider">Documents</span>
                <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wider">Deal Value</span>
                <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wider">Added</span>
              </div>

              {/* Table Rows */}
              <motion.div
                className="divide-y divide-gray-100"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
              >
                {contacts.map((contact) => (
                  <motion.button
                    key={contact.id}
                    onClick={() => setSelectedContact(contact)}
                    className="w-full grid grid-cols-[1fr_80px_1fr_100px_100px_100px] gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors text-left group"
                    variants={fadeInUp}
                    transition={{ duration: 0.3 }}
                  >
                    {/* Name & Email */}
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-9 w-9 flex-shrink-0">
                        <AvatarFallback className="bg-teal-50 text-teal-600 text-[13px] font-medium">
                          {getInitials(contact)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="font-medium text-[13px] text-gray-900 truncate group-hover:text-teal-600 transition-colors">
                          {getDisplayName(contact)}
                        </div>
                        <div className="text-[12px] text-gray-500 truncate">
                          {contact.email}
                        </div>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="flex items-center">
                      {contact.status === 'client' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-teal-50 text-teal-700">
                          Client
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                          Prospect
                        </span>
                      )}
                    </div>

                    {/* Company */}
                    <div className="flex items-center min-w-0">
                      {contact.company ? (
                        <div className="flex items-center gap-2 text-[13px] text-gray-700 truncate">
                          <Building2 className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          <span className="truncate">{contact.company}</span>
                        </div>
                      ) : (
                        <span className="text-[13px] text-gray-400">—</span>
                      )}
                    </div>

                    {/* Documents */}
                    <div className="flex items-center">
                      <div className="flex items-center gap-1.5 text-[13px]">
                        <FileText className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-medium text-gray-900">{contact.total_documents_count}</span>
                      </div>
                    </div>

                    {/* Deal Value */}
                    <div className="flex items-center">
                      {contact.deal_value ? (
                        <span className="text-[13px] font-medium text-teal-600">
                          {formatCurrency(contact.deal_value)}
                        </span>
                      ) : (
                        <span className="text-[13px] text-gray-400">—</span>
                      )}
                    </div>

                    {/* Added Date */}
                    <div className="flex items-center">
                      <span className="text-[13px] text-gray-500">
                        {format(new Date(contact.created_at), "MMM d, yyyy")}
                      </span>
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Modals */}
      <ContactFormModal
        open={formModalOpen}
        onOpenChange={setFormModalOpen}
        contact={editingContact}
        workspaceId={workspaceId || ""}
        onSuccess={handleFormSuccess}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="Delete Contact"
        itemName={contactToDelete ? getDisplayName(contactToDelete) : undefined}
      />
    </div>
  );
};

export default Contacts;
