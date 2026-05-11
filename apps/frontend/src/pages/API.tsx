import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APIDocumentation } from "@/components/APIDocumentation";
import { APIReference } from "@/components/APIReference";
import { APIDocsLayout } from "@/components/APIDocsLayout";

const API = () => {
  const [activeTab, setActiveTab] = useState("documentation");

  return (
    <APIDocsLayout>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-8">
          <TabsTrigger value="documentation">Developer Guide</TabsTrigger>
          <TabsTrigger value="reference">API Reference</TabsTrigger>
        </TabsList>

        <TabsContent value="documentation">
          <APIDocumentation />
        </TabsContent>

        <TabsContent value="reference">
          <APIReference onNavigateToSection={(sectionId) => {
            setActiveTab("documentation");
            setTimeout(() => {
              const element = document.getElementById(sectionId);
              if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "start" });
                window.history.pushState(null, "", `#${sectionId}`);
              }
            }, 100);
          }} />
        </TabsContent>
      </Tabs>
    </APIDocsLayout>
  );
};

export default API;
