import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Play, BookOpen, FileText, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Tutorial {
  id: string;
  title: string;
  slug: string;
  description: string;
  duration: string | null;
  video_url: string | null;
  video_file_url: string | null;
}

interface Guide {
  id: string;
  title: string;
  slug: string;
  description: string;
  content: any;
}

interface UseCase {
  id: string;
  title: string;
  slug: string;
  description: string;
  content: any;
}

export function APIResources() {
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResources();
  }, []);

  const loadResources = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      
      const [tutorialsRes, guidesRes, useCasesRes] = await Promise.all([
        fetch(`${apiUrl}/api/resources/tutorials`),
        fetch(`${apiUrl}/api/resources/guides`),
        fetch(`${apiUrl}/api/resources/use-cases`),
      ]);

      if (tutorialsRes.ok) {
        const tutorialsData = await tutorialsRes.json();
        setTutorials(tutorialsData.tutorials || []);
      }

      if (guidesRes.ok) {
        const guidesData = await guidesRes.json();
        setGuides(guidesData.guides || []);
      }

      if (useCasesRes.ok) {
        const useCasesData = await useCasesRes.json();
        setUseCases(useCasesData.useCases || []);
      }
    } catch (error) {
      console.error("Error loading resources:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-12">
        <div className="text-center text-muted-foreground py-12">Loading resources...</div>
      </div>
    );
  }
  return (
    <div className="space-y-12">
      {/* Tutorials Section */}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Tutorials</h2>
          <p className="text-muted-foreground">
            Video tutorials to help you get started and master the Proply API
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tutorials.map((tutorial) => (
            <Link key={tutorial.id} to={`/tutorials/${tutorial.slug}`} className="block group">
              <Card className="h-full hover:shadow-lg transition-all border-border group-hover:border-primary/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <Play className="h-5 w-5" />
                    </div>
                    {tutorial.duration && (
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                        {tutorial.duration}
                      </span>
                    )}
                  </div>
                  <CardTitle className="text-lg group-hover:text-primary transition-colors">
                    {tutorial.title}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Video Tutorial</p>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm mb-4">
                    {tutorial.description}
                  </CardDescription>
                  <div className="flex items-center justify-between text-sm text-muted-foreground group-hover:text-primary transition-colors">
                    <span>Watch tutorial</span>
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Guides Section */}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Guides</h2>
          <p className="text-muted-foreground">
            Comprehensive guides and documentation to help you build with Proply
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {guides.map((guide) => (
            <Card
              key={guide.id}
              className="group hover:shadow-lg transition-all cursor-pointer border-border hover:border-primary/50"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <BookOpen className="h-5 w-5" />
                  </div>
                </div>
                <CardTitle className="text-lg group-hover:text-primary transition-colors">
                  {guide.title}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Guide</p>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm mb-4">
                  {guide.description}
                </CardDescription>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between group-hover:text-primary"
                  onClick={() => {
                    // TODO: Navigate to guide detail page
                    console.log(`Navigate to guide ${guide.slug}`);
                  }}
                >
                  <span>Read guide</span>
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Use Cases Section */}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Use Cases</h2>
          <p className="text-muted-foreground">
            Real-world examples and implementations for common business scenarios
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {useCases.map((useCase) => (
            <Card
              key={useCase.id}
              className="group hover:shadow-lg transition-all cursor-pointer border-border hover:border-primary/50"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Briefcase className="h-5 w-5" />
                  </div>
                </div>
                <CardTitle className="text-lg group-hover:text-primary transition-colors">
                  {useCase.title}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Use Case</p>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm mb-4">
                  {useCase.description}
                </CardDescription>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between group-hover:text-primary"
                  onClick={() => {
                    // TODO: Navigate to use case detail page
                    console.log(`Navigate to use case ${useCase.slug}`);
                  }}
                >
                  <span>View use case</span>
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

