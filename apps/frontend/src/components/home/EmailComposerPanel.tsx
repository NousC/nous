import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Check, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { EmailDraft } from './EmailDraftCard';

interface EmailComposerPanelProps {
  draft: EmailDraft;
  onClose: () => void;
  onSent?: () => void;
}

type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

function EmailChips({
  emails,
  onChange,
  placeholder,
}: {
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder: string;
}) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addEmail = (email: string) => {
    const trimmed = email.trim();
    if (trimmed && trimmed.includes('@') && !emails.includes(trimmed)) {
      onChange([...emails, trimmed]);
    }
    setInputValue('');
  };

  const removeEmail = (index: number) => {
    onChange(emails.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && inputValue.trim()) {
      e.preventDefault();
      addEmail(inputValue);
    }
    if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      removeEmail(emails.length - 1);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 min-h-[28px] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {emails.map((email, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-sm text-gray-700"
        >
          {email}
          <button
            onClick={(e) => { e.stopPropagation(); removeEmail(i); }}
            className="text-gray-400 hover:text-gray-600 ml-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => inputValue.trim() && addEmail(inputValue)}
        placeholder={emails.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-gray-400"
      />
    </div>
  );
}

export function EmailComposerPanel({ draft, onClose, onSent }: EmailComposerPanelProps) {
  const { session, userData } = useAuth();
  const [to, setTo] = useState<string[]>(draft.to || []);
  const [cc, setCc] = useState<string[]>(draft.cc || []);
  const [showCc, setShowCc] = useState((draft.cc || []).length > 0);
  const [subject, setSubject] = useState(draft.subject || '');
  const [bodyHtml, setBodyHtml] = useState(draft.body_html || '');
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Get workspace ID from auth context (same source as chat API calls)
  const workspaceId = userData?.workspace?.id;

  useEffect(() => {
    if (bodyRef.current && bodyHtml) {
      bodyRef.current.innerHTML = bodyHtml;
    }
  }, []);

  const handleSend = async () => {
    if (to.length === 0) {
      setErrorMessage('Add at least one recipient');
      setSendStatus('error');
      return;
    }

    setSendStatus('sending');
    setErrorMessage('');

    try {
      const currentBody = bodyRef.current?.innerHTML || bodyHtml;
      const apiUrl = import.meta.env.VITE_API_URL ?? '';

      const res = await fetch(`${apiUrl}/api/email/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          to,
          cc: showCc ? cc : [],
          subject,
          body_html: currentBody,
          workspace_id: workspaceId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to send email');
      }

      setSendStatus('sent');
      setTimeout(() => {
        onSent?.();
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error('[EMAIL_SEND]', err);
      setErrorMessage(err.message || 'Failed to send email');
      setSendStatus('error');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed top-0 right-0 h-full w-[480px] max-w-full bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">New Email</h2>
          <div className="flex items-center gap-2">
            {sendStatus === 'sent' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
                <Check className="w-4 h-4" />
                Sent
              </span>
            ) : (
              <button
                onClick={handleSend}
                disabled={sendStatus === 'sending' || to.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sendStatus === 'sending' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {sendStatus === 'sending' ? 'Sending...' : 'Send'}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {sendStatus === 'error' && errorMessage && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-red-50 border-b border-red-100 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {errorMessage}
          </div>
        )}

        {/* Email fields */}
        <div className="flex-1 overflow-y-auto">
          {/* To */}
          <div className="border-b border-gray-200 px-5 py-3">
            <div className="flex items-start gap-4">
              <span className="text-sm text-gray-400 pt-1.5 w-14 flex-shrink-0">To</span>
              <div className="flex-1">
                <EmailChips emails={to} onChange={setTo} placeholder="Add recipients..." />
              </div>
              {!showCc && (
                <button
                  onClick={() => setShowCc(true)}
                  className="text-xs text-gray-400 hover:text-gray-600 pt-1.5 flex-shrink-0 border border-gray-200 rounded px-1.5 py-0.5"
                >
                  +Cc
                </button>
              )}
            </div>
          </div>

          {/* Cc */}
          {showCc && (
            <div className="border-b border-gray-200 px-5 py-3">
              <div className="flex items-start gap-4">
                <span className="text-sm text-gray-400 pt-1.5 w-14 flex-shrink-0">Cc</span>
                <div className="flex-1">
                  <EmailChips emails={cc} onChange={setCc} placeholder="Add Cc..." />
                </div>
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="border-b border-gray-200 px-5 py-3">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400 w-14 flex-shrink-0">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject..."
                className="flex-1 text-sm text-gray-900 outline-none bg-transparent placeholder:text-gray-400 font-medium"
              />
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-5">
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              className="min-h-[300px] text-sm text-gray-800 leading-relaxed outline-none prose prose-sm max-w-none [&_p]:mb-3 [&_ul]:mb-3 [&_li]:mb-1"
              onInput={() => {
                if (bodyRef.current) {
                  setBodyHtml(bodyRef.current.innerHTML);
                }
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Sending from {draft.sender_email || 'your connected Gmail'}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default EmailComposerPanel;
