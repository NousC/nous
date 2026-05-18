import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

interface APIDocsLayoutProps {
  children: React.ReactNode;
}

const docsSections = [
  {
    title: "Getting Started",
    items: [
      { id: "intro", label: "Overview", href: "/api#intro" },
      { id: "authentication", label: "Authentication", href: "/api#authentication" },
      { id: "mcp-server", label: "MCP Server (Beta)", href: "/api#mcp-server" },
    ],
  },
  {
    title: "Agent",
    items: [
      { id: "agent", label: "POST /agent", href: "/api#agent" },
      { id: "agent-actions", label: "Agent Actions", href: "/api#agent-actions" },
      { id: "agent-webhooks", label: "Webhooks", href: "/api#agent-webhooks" },
    ],
  },
  {
    title: "Resources",
    items: [
      { id: "documents", label: "Documents", href: "/api#documents" },
      { id: "templates", label: "Templates", href: "/api#templates" },
      { id: "contacts", label: "Contacts", href: "/api#contacts" },
      { id: "signing", label: "Signing", href: "/api#signing" },
    ],
  },
];

export function APIDocsLayout({ children }: APIDocsLayoutProps) {
  const location = useLocation();
  const [activeSection, setActiveSection] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Scroll spy: observe sections and update active section
  useEffect(() => {
    const sections = document.querySelectorAll("section[id]");
    const sectionIds = Array.from(sections).map(s => s.id);
    
    const updateActiveSection = () => {
      const scrollPosition = window.scrollY + 150; // Offset for better detection
      
      for (let i = sectionIds.length - 1; i >= 0; i--) {
        const section = document.getElementById(sectionIds[i]);
        if (section) {
          const sectionTop = section.offsetTop;
          const sectionHeight = section.offsetHeight;
          
          if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
            setActiveSection(sectionIds[i]);
            window.history.replaceState(null, "", `#${sectionIds[i]}`);
            return;
          }
        }
      }
    };

    // Use IntersectionObserver for more accurate detection
    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Find the section that's most visible
        let mostVisible: { id: string; ratio: number } | null = null;
        
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const ratio = entry.intersectionRatio;
            if (!mostVisible || ratio > mostVisible.ratio) {
              mostVisible = {
                id: entry.target.id,
                ratio: ratio,
              };
            }
          }
        });

        if (mostVisible && mostVisible.ratio > 0.1) {
          setActiveSection(mostVisible.id);
          window.history.replaceState(null, "", `#${mostVisible.id}`);
        }
      },
      {
        rootMargin: "-100px 0px -70% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    sections.forEach((section) => {
      observerRef.current?.observe(section);
    });

    // Also listen to scroll events for more responsive updates
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    updateActiveSection(); // Initial check

    return () => {
      sections.forEach((section) => {
        observerRef.current?.unobserve(section);
      });
      window.removeEventListener("scroll", updateActiveSection);
    };
  }, []);

  // Update active section based on hash on mount
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if (hash) {
      setActiveSection(hash);
      // Scroll to section after a brief delay to ensure DOM is ready
      setTimeout(() => {
        const element = document.getElementById(hash);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    }
  }, [location.hash]);

  const handleNavClick = (itemId: string) => {
    setActiveSection(itemId);
    window.location.hash = itemId;
    const element = document.getElementById(itemId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-[#faf8f5]">
      {/* Left Navigation Sidebar */}
      <aside className="w-64 border-r border-gray-200 bg-[#faf8f5] flex-shrink-0 overflow-y-auto sticky top-0 h-screen">
        <div className="p-6">
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900">API Reference</h2>
            <p className="text-sm text-gray-500 mt-1">Build with Nous</p>
          </div>

          <nav className="space-y-6">
            {docsSections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  {section.title}
                </h3>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = activeSection === item.id;
                    return (
                      <li key={item.id}>
                        <a
                          href={item.href}
                          onClick={(e) => {
                            e.preventDefault();
                            handleNavClick(item.id);
                          }}
                          className={cn(
                            "block px-3 py-1.5 text-sm rounded-md transition-colors",
                            isActive
                              ? "bg-landing-green/10 text-landing-green font-medium"
                              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/50"
                          )}
                        >
                          {item.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-4xl mx-auto px-8 py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
