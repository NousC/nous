import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Zap, FileText, ArrowRight, Workflow } from 'lucide-react';

export interface CTAOptions {
  HTMLAttributes: Record<string, any>;
}

const CTARendererComponent = ({ node }: any) => {
  return (
    <NodeViewWrapper className="cta-renderer my-4">
      <section className="relative py-12 px-8 bg-landing-green text-white overflow-hidden rounded-2xl">
        {/* Abstract Background Shapes */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-white/[0.03]" />
          <div className="absolute top-[20%] right-[-10%] w-[35vw] h-[35vw] rounded-[3rem] bg-white/[0.03] rotate-12" />
          <div className="absolute bottom-[-10%] left-[20%] w-[25vw] h-[25vw] rounded-full bg-white/[0.02]" />
        </div>

        <div className="container mx-auto max-w-6xl relative z-10">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left Side - Text */}
            <div className="space-y-6">
              <div className="space-y-4">
                <h2
                  className="text-4xl md:text-5xl lg:text-6xl font-public-sans font-bold tracking-tight text-white"
                  style={{ color: '#ffffff' }}
                >
                  Build this workflow in Assetly
                </h2>
                <p className="text-xl text-white/90 leading-relaxed">
                  Automate your document workflows, generate proposals in minutes, and connect your favorite tools—all in one platform.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-2">
                <a href="/signup">
                  <Button
                    size="lg"
                    className="bg-landing-yellow hover:bg-landing-yellow/90 text-landing-green text-base px-8 py-6 h-auto rounded-full font-medium transition-all min-w-[180px] flex items-center gap-2"
                  >
                    Start for free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
              </div>

              <div className="flex items-center gap-6 pt-4 text-sm text-white/70">
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4" />
                  <span>Visual Workflow Builder</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>Document Automation</span>
                </div>
              </div>
            </div>

            {/* Right Side - Graphic Illustration */}
            <div className="relative hidden md:block">
              <div className="relative bg-white/10 rounded-2xl p-8 border border-white/20 backdrop-blur-sm">
                {/* Workflow illustration */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-lg bg-landing-yellow flex items-center justify-center">
                      <Zap className="h-6 w-6 text-landing-green" />
                    </div>
                    <div>
                      <div className="h-3 w-32 bg-white/30 rounded mb-2"></div>
                      <div className="h-2 w-24 bg-white/20 rounded"></div>
                    </div>
                  </div>

                  {/* Workflow items */}
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-white/10 rounded-lg border border-white/20">
                      <div className="w-8 h-8 rounded bg-landing-yellow/30 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-4 w-4 text-landing-yellow" />
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="h-2.5 w-full bg-white/30 rounded"></div>
                        <div className="h-2 w-3/4 bg-white/20 rounded"></div>
                        <div className="h-2 w-1/2 bg-white/20 rounded"></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </NodeViewWrapper>
  );
};

export const CTARenderer = Node.create<CTAOptions>({
  name: 'cta',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: 'block',

  content: '',

  addAttributes() {
    return {
      id: {
        default: Math.random().toString(36).substring(7),
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {};
          }
          return {
            'data-id': attributes.id,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="cta"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'cta',
        'data-id': node.attrs.id || Math.random().toString(36).substring(7),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CTARendererComponent);
  },
});
