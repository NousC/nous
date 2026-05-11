import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, LogOut, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function ProfileDropdown() {
  const { userData, signOut } = useAuth();
  const navigate = useNavigate();

  const getInitials = (name: string) => {
    if (!name) return "U";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const handleSettings = () => {
    navigate("/settings");
  };

  const userName = userData?.user?.name || userData?.user?.email?.split("@")[0] || "User";
  const userEmail = userData?.user?.email || "";
  const profilePictureUrl = userData?.user?.profile_picture_url;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:ring-offset-2 focus:ring-offset-background transition-all">
          <Avatar className="h-8 w-8 border border-gray-200/60 shadow-sm">
            <AvatarImage src={profilePictureUrl || undefined} alt={userName} />
            <AvatarFallback className="text-xs bg-gray-50 text-gray-600">
              {getInitials(userName)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-lg border-gray-200/60">
        <div className="px-2 py-2">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 border border-gray-200/60 shadow-sm">
              <AvatarImage src={profilePictureUrl || undefined} alt={userName} />
              <AvatarFallback className="text-sm bg-gray-50 text-gray-600">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {userName}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {userEmail}
              </p>
            </div>
          </div>
        </div>
        <DropdownMenuSeparator className="my-1 bg-gray-100" />
        <DropdownMenuItem onClick={handleSettings} className="rounded-lg text-[13px] text-gray-600 hover:text-gray-900 cursor-pointer py-2">
          <Settings className="h-4 w-4 mr-2.5 text-gray-400" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 bg-gray-100" />
        <DropdownMenuItem onClick={handleSignOut} className="rounded-lg text-[13px] text-red-500 focus:text-red-600 focus:bg-red-50 cursor-pointer py-2">
          <LogOut className="h-4 w-4 mr-2.5" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
