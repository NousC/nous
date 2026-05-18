import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, Upload, User } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/lib/supabase";

interface PersonalInfoStepProps {
  firstName: string;
  setFirstName: (value: string) => void;
  email: string;
  profilePictureUrl: string;
  setProfilePictureUrl: (value: string) => void;
  onNext: () => void;
  isLoading: boolean;
  userId?: string;
}

export function PersonalInfoStep({
  firstName,
  setFirstName,
  email,
  profilePictureUrl,
  setProfilePictureUrl,
  onNext,
  isLoading,
  userId,
}: PersonalInfoStepProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setUploading(true);
    try {
      // Get current user ID for the file path
      const currentUserId = userId || (await supabase.auth.getUser()).data.user?.id;
      if (!currentUserId) {
        toast.error("User not authenticated");
        setUploading(false);
        return;
      }

      // Generate unique filename with user folder (required by storage policy)
      const ext = file.name.split(".").pop();
      const fileName = `${currentUserId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      // Upload to Supabase storage
      const { data, error } = await supabase.storage
        .from("user-profiles")
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (error) {
        console.error("Upload error:", error);
        if (error.message?.includes("Bucket not found") || error.message?.includes("bucket")) {
          toast.error("Storage not configured. Please contact support.");
        } else {
          toast.error(`Failed to upload: ${error.message}`);
        }
        return;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("user-profiles")
        .getPublicUrl(data.path);

      setProfilePictureUrl(urlData.publicUrl);
      toast.success("Profile picture uploaded");
    } catch (error: any) {
      console.error("Upload error:", error);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const canContinue = firstName.trim().length > 0;

  return (
    <div className="space-y-8">
      {/* Header - Left aligned, premium minimal style */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-2">
          Let's get to know you
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Tell us a bit about yourself to personalize your Nous experience
        </p>
      </div>

      {/* Profile Picture Upload */}
      <div className="flex justify-start">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative cursor-pointer group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {profilePictureUrl ? (
            <img
              src={profilePictureUrl}
              alt="Profile"
              className="w-20 h-20 rounded-full object-cover ring-4 ring-gray-100 group-hover:ring-emerald-100 transition-all"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-emerald-50 transition-colors">
              <User className="w-8 h-8 text-gray-400" />
            </div>
          )}

          {/* Upload overlay */}
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            {uploading ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <Upload className="w-5 h-5 text-white" />
            )}
          </div>
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium text-gray-700">
            Name *
          </Label>
          <Input
            id="name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="John Doe"
            className="h-11 rounded-lg border-gray-200 focus:border-emerald-500 focus:ring-emerald-500"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email
          </Label>
          <Input
            id="email"
            value={email}
            readOnly
            disabled
            className="h-11 rounded-lg bg-gray-50 border-gray-200 text-gray-500"
          />
        </div>
      </div>

      {/* Continue Button */}
      <Button
        onClick={onNext}
        disabled={!canContinue || isLoading}
        className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[15px] font-medium"
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        Continue
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}
