import { motion } from 'framer-motion';
import { Mail, ChevronRight } from 'lucide-react';

export interface EmailDraft {
  to: string[];
  cc: string[];
  subject: string;
  body_html: string;
  sender_email?: string;
}

interface EmailDraftCardProps {
  draft: EmailDraft;
  onOpen: () => void;
}

export function EmailDraftCard({ draft, onOpen }: EmailDraftCardProps) {
  const recipientPreview = draft.to.length > 0
    ? draft.to.length === 1
      ? draft.to[0]
      : `${draft.to[0]} +${draft.to.length - 1}`
    : 'No recipient';

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onOpen}
      className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all cursor-pointer text-left group shadow-sm"
    >
      {/* Gmail icon */}
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-50 border border-gray-100 flex-shrink-0 group-hover:bg-white transition-colors">
        <img
          src="/provider-logos/gmail.svg"
          alt="Gmail"
          className="w-5 h-5 object-contain"
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {draft.subject || 'Email draft'}
        </p>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          To: {recipientPreview}
        </p>
      </div>

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 flex-shrink-0 transition-colors" />
    </motion.button>
  );
}

export default EmailDraftCard;
