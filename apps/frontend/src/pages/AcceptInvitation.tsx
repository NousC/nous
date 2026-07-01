import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { Loader2, Lock, Users, Mail } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, session, signIn, signUp, signInWithGoogle, refreshUserData } = useAuth();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [invitation, setInvitation] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Sign up/login form state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isSignUp, setIsSignUp] = useState(true); // Default to sign up
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [pendingAccept, setPendingAccept] = useState(false);
  const acceptingRef = useRef(false);

  // Load invitation details
  useEffect(() => {
    if (!token) {
      setError("Invalid invitation link");
      setLoading(false);
      return;
    }

    const loadInvitation = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL ?? "";
        const response = await fetch(`${apiUrl}/api/invitations/${token}`);

        if (response.ok) {
          const data = await response.json();
          setInvitation(data.invitation);
          
          // Pre-fill email from invitation
          if (data.invitation?.email) {
            setEmail(data.invitation.email);
          }
        } else {
          const errorData = await response.json().catch(() => ({ error: "Invitation not found" }));
          setError(errorData.detail || errorData.error || "Invitation not found");
        }
      } catch (err: any) {
        console.error("Failed to load invitation:", err);
        setError(err.message || "Failed to load invitation");
      } finally {
        setLoading(false);
      }
    };

    loadInvitation();
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token) {
      setError("Invalid invitation token");
      return;
    }

    // If no session, show auth form
    if (!session?.access_token) {
      setShowEmailForm(true);
      setIsSignUp(true);
      return;
    }

    // Guard against a double network call — the auto-accept effect, the OAuth
    // return, and the button can all trigger this. The server is idempotent too,
    // but firing once keeps it clean.
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    setError(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/invitations/${token}/accept`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(`You've joined ${data.team?.name || "the team"}!`);

        // Refresh user data to update onboarding status
        if (refreshUserData) {
          await refreshUserData();
        }

        // A member/viewer joins an already-set-up workspace, so they skip the
        // workspace onboarding and get the light member setup (connect their own
        // accounts + grab their scoped agent key). Owners/admins go to the app.
        const dest = (data.role === "member" || data.role === "viewer") ? "/member-setup" : "/";
        setTimeout(() => {
          navigate(dest);
        }, 500);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Failed to accept invitation" }));
        const errorMessage = errorData.detail || errorData.error || "Failed to accept invitation";
        toast.error(errorMessage);
        setError(errorMessage);
        acceptingRef.current = false; // allow a manual retry
      }
    } catch (err: any) {
      console.error("Failed to accept invitation:", err);
      const errorMessage = err.message || "Failed to accept invitation";
      toast.error(errorMessage);
      setError(errorMessage);
      acceptingRef.current = false; // allow a manual retry
    } finally {
      setAccepting(false);
    }
  }, [token, session, navigate, refreshUserData]);

  // Auto-accept invitation when session becomes available after auth
  useEffect(() => {
    if (pendingAccept && session?.access_token && invitation && !accepting && !error) {
      // Session is now available, accept the invitation
      const acceptInvitation = async () => {
        setPendingAccept(false);
        // Small delay to ensure everything is ready
        await new Promise(resolve => setTimeout(resolve, 500));
        if (refreshUserData) {
          await refreshUserData();
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        handleAccept();
      };
      acceptInvitation();
    }
  }, [pendingAccept, session, invitation, accepting, error, handleAccept, refreshUserData]);

  // Frictionless path: when the user lands back on this page already
  // authenticated (e.g. returning from Google sign-in, where the pendingAccept
  // flag was wiped by the full-page redirect), auto-accept — but ONLY when the
  // signed-in email matches the invite, so a wrong-account visitor still sees the
  // mismatch screen instead of a silent failed accept. One less click.
  const autoFired = useRef(false);
  useEffect(() => {
    if (autoFired.current) return;
    if (accepting || error || pendingAccept) return;
    if (!isAuthenticated || !session?.access_token || !invitation) return;
    const sameEmail = invitation.email?.toLowerCase() === session.user?.email?.toLowerCase();
    if (!sameEmail) return;
    autoFired.current = true;
    handleAccept();
  }, [isAuthenticated, session, invitation, accepting, error, pendingAccept, handleAccept]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || !name.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setAuthLoading(true);
    try {
        const { error, data } = await signUp(email, password, name);
        if (error) {
          toast.error(error.message || "Failed to sign up");
        setAuthLoading(false);
          return;
        }
      
      // If signup created a session immediately, set flag to auto-accept when session is ready
      if (data?.session) {
        toast.success("Account created!");
        setPendingAccept(true);
        setShowEmailForm(false);
        setAuthLoading(false);
      } else {
        // Email confirmation required
        toast.success("Account created! Please check your email to confirm your account, then sign in.");
        setIsSignUp(false);
        setAuthLoading(false);
      }
    } catch (err: any) {
      toast.error(err.message || "Authentication failed");
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setAuthLoading(true);
    try {
        const { error } = await signIn(email, password);
        if (error) {
          toast.error(error.message || "Failed to sign in");
        setAuthLoading(false);
          return;
        }
        toast.success("Signed in successfully!");
      setPendingAccept(true);
      setShowEmailForm(false);
      setAuthLoading(false);
    } catch (err: any) {
      toast.error(err.message || "Authentication failed");
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    // Come back to THIS invite page (token in the URL) after Google, so the
    // accept can auto-fire on return — otherwise the redirect lands on the
    // dashboard and the invite is forgotten.
    const returnPath = token ? `/accept-invitation?token=${encodeURIComponent(token)}` : "/accept-invitation";
    const { error } = await signInWithGoogle(returnPath);

    if (error) {
      toast.error(error.message || "Failed to sign up with Google");
      setAuthLoading(false);
    }
    // On success the browser redirects to Google, then back to returnPath; the
    // auto-accept effect below fires once the session is live. No local flag
    // needed (a full-page redirect would wipe it anyway).
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      const parts = name.trim().split(" ");
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return "U";
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
        <div className="w-full max-w-md px-6">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-10 space-y-6">
            <div className="flex items-center justify-center gap-2">
              <div className="w-8 h-8 bg-muted/30 rounded animate-pulse" />
              <div className="h-6 w-24 bg-muted/30 rounded animate-pulse" />
            </div>
            <div className="space-y-4">
              <div className="h-8 w-48 mx-auto bg-muted/30 rounded animate-pulse" />
              <div className="h-4 w-full bg-muted/30 rounded animate-pulse" />
              <div className="h-4 w-3/4 mx-auto bg-muted/30 rounded animate-pulse" />
            </div>
            <div className="h-10 w-full bg-muted/30 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-10 space-y-6 text-center">
              <div className="flex items-center justify-center gap-2 mb-4">
                <img src="/nous-logo.svg" alt="Nous" className="w-8 h-8" />
                <span className="font-semibold text-xl text-[#2D2D2D]">Nous</span>
            </div>
              <h1 className="text-2xl font-bold text-[#2D2D2D]">Invitation Error</h1>
              <p className="text-gray-600">{error}</p>
              <Button onClick={() => navigate("/login")} className="w-full bg-[#2D2D2D] hover:bg-[#2D2D2D]/90 text-white">
              Go to Login
            </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return null;
  }

  // If authenticated, show accept button
  if (isAuthenticated && session && !showEmailForm) {
    // Check if email matches
    if (invitation.email.toLowerCase() !== session.user?.email?.toLowerCase()) {
  return (
        <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
          <div className="flex-1 flex items-center justify-center px-6 py-8">
            <div className="w-full max-w-md">
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-10 space-y-6">
                <div className="flex items-center justify-center gap-2">
                  <img src="/nous-logo.svg" alt="Nous" className="w-8 h-8" />
                  <span className="font-semibold text-xl text-[#2D2D2D]">Nous</span>
                </div>
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  <Mail className="h-4 w-4 inline mr-2" />
                  This invitation was sent to {invitation.email}, but you're signed in as {session.user?.email}. Please sign out and sign in with the correct email address.
                </div>
                <Button onClick={() => navigate("/login")} className="w-full bg-[#2D2D2D] hover:bg-[#2D2D2D]/90 text-white">
                  Go to Login
                </Button>
            </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-10 space-y-6">
              <div className="flex items-center justify-center gap-2">
                <img src="/nous-logo.svg" alt="Nous" className="w-8 h-8" />
                <span className="font-semibold text-xl text-[#2D2D2D]">Nous</span>
              </div>
              
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  {error}
                </div>
              )}

              <Button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full h-12 bg-[#2D2D2D] hover:bg-[#2D2D2D]/90 text-white rounded-lg font-medium shadow-sm hover:shadow transition-shadow"
              >
                {accepting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  "Accept Invitation"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show sign up/login form
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* Main Content - Centered */}
      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-md">
          {/* Premium Card Design */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 md:p-10 space-y-8">
            {/* Logo - Inside Card */}
            <div className="flex items-center justify-center gap-2">
              <img src="/nous-logo.svg" alt="Nous" className="w-8 h-8" />
              <span className="font-semibold text-xl text-[#2D2D2D]">Nous</span>
            </div>

            {/* Invitation Header */}
            <div className="text-center space-y-3">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
              </div>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-[#2D2D2D] tracking-tight leading-tight">
                {isSignUp ? "You're invited!" : "Welcome back"}
              </h1>
              <div className="space-y-2">
                <p className="text-gray-600 text-base">
                  {invitation.invited_by?.name || invitation.invited_by?.email || "Someone"} invited you to join
                </p>
                <p className="text-lg font-semibold text-[#2D2D2D]">{invitation.team?.name || "the team"}</p>
                <p className="text-sm text-gray-500">as {invitation.role}</p>
              </div>
            </div>

            {/* Auth Options - Stacked Buttons */}
            <div className="space-y-3">
              {/* Google Sign Up/In */}
              <Button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full h-12 bg-white hover:bg-gray-50 text-[#2D2D2D] border border-gray-300 rounded-lg flex items-center justify-center gap-3 px-4 shadow-sm hover:shadow transition-shadow"
                disabled={authLoading}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="text-base font-medium">
                  {isSignUp ? "Sign up with Google" : "Sign in with Google"}
                </span>
              </Button>

              {/* Email Sign Up/In Button or Form */}
              {!showEmailForm ? (
                <Button
                  type="button"
                  onClick={() => setShowEmailForm(true)}
                  className="w-full h-12 bg-white hover:bg-gray-50 text-[#2D2D2D] border border-gray-300 rounded-lg flex items-center justify-center gap-3 px-4 shadow-sm hover:shadow transition-shadow"
                >
                  <Lock className="h-5 w-5 text-[#2D2D2D]" />
                  <span className="text-base font-medium">
                    {isSignUp ? "Sign up with email" : "Sign in with email"}
                  </span>
                </Button>
              ) : (
                <form onSubmit={isSignUp ? handleSignup : handleLogin} className="space-y-4 pt-2">
              {isSignUp && (
                <div>
                      <Input
                    type="text"
                        placeholder="Full Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                        className="h-12 text-base bg-white border-gray-300 rounded-lg focus:border-[#2D2D2D] focus:ring-1 focus:ring-[#2D2D2D]"
                    disabled={authLoading}
                        autoFocus
                        required
                  />
                </div>
              )}
              <div>
                    <Input
                  type="email"
                      placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-12 text-base bg-white border-gray-300 rounded-lg focus:border-[#2D2D2D] focus:ring-1 focus:ring-[#2D2D2D]"
                      disabled={authLoading || true} // Email is pre-filled from invitation
                />
              </div>
              <div>
                    <Input
                  type="password"
                      placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="h-12 text-base bg-white border-gray-300 rounded-lg focus:border-[#2D2D2D] focus:ring-1 focus:ring-[#2D2D2D]"
                  disabled={authLoading}
                />
              </div>
                <Button
                    type="submit"
                    className="w-full h-12 bg-[#2D2D2D] hover:bg-[#2D2D2D]/90 text-white rounded-lg font-medium shadow-sm hover:shadow transition-shadow"
                  disabled={authLoading}
                >
                    {authLoading ? (isSignUp ? "Creating account..." : "Signing in...") : (isSignUp ? "Sign up" : "Sign in")}
                </Button>
                </form>
              )}
              </div>

            {/* Invited users create an account (Google handles a returning login
                transparently). No sign-in toggle — an invite is an onboarding, not
                a login screen. */}
            <p className="text-center text-xs text-gray-400 pt-2">
              Use the Google account for {invitation.email} to join.
            </p>
          </div>
                </div>
            </div>

      {/* Footer */}
      <div className="pb-6 px-6">
        <div className="text-left text-xs text-gray-500 space-x-4">
          <span>© 2025 Nous</span>
          <a href="/help" className="hover:underline">Help Center</a>
          <a href="/terms" className="hover:underline">Terms and Conditions</a>
          <a href="/privacy" className="hover:underline">Privacy policy</a>
        </div>
            </div>
    </div>
  );
}
