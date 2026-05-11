import { useState, useEffect } from "react";
import { SettingsModal } from "@/components/SettingsModal";

const Settings = () => {
  const [settingsOpen, setSettingsOpen] = useState(true);

  // Close modal and navigate back when closed
  const handleClose = (open: boolean) => {
    setSettingsOpen(open);
    if (!open) {
      // Navigate back to home when settings modal is closed
      window.history.back();
    }
  };

  return <SettingsModal open={settingsOpen} onOpenChange={handleClose} />;
};

export default Settings;
