import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from '@/components/ui/accordion';
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";

export interface FAQOptions {
  HTMLAttributes: Record<string, any>;
}

const FAQRendererComponent = ({ node }: any) => {
  const { items } = node.attrs;

  if (!items || items.length === 0 || items.every((item: { question: string; answer: string }) => !item.question && !item.answer)) {
    return null;
  }

  // Filter out empty items
  const validItems = items.filter((item: { question: string; answer: string }) => item.question || item.answer);

  if (validItems.length === 0) {
    return null;
  }

  return (
    <NodeViewWrapper className="faq-renderer my-12 not-prose">
      <div className="w-full">
        <h2 className="!font-space-mono !text-2xl md:!text-3xl !font-bold !mb-8 !tracking-tight !text-white !mt-0">
          Frequently Asked Questions
        </h2>
        <Accordion type="single" collapsible className="w-full space-y-2">
          {validItems.map((item: { question: string; answer: string }, index: number) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className="!border !border-white/10 !rounded-xl !bg-white/5 !px-5 data-[state=open]:!bg-white/[0.07]"
            >
              <AccordionPrimitive.Header className="flex">
                <AccordionPrimitive.Trigger className="flex flex-1 items-center justify-between py-5 text-left !font-space-mono !text-base !font-medium !text-white hover:!text-landing-yellow transition-all [&[data-state=open]>svg]:rotate-45">
                  {item.question || 'Question'}
                  <Plus className="h-5 w-5 shrink-0 text-white/50 transition-transform duration-200" />
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionContent className="!font-space-mono !text-white/70 !leading-relaxed !pb-5 !pt-0">
                {item.answer || 'Answer'}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </NodeViewWrapper>
  );
};

export const FAQRenderer = Node.create<FAQOptions>({
  name: 'faq',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: 'block',

  content: '',

  addAttributes() {
    return {
      items: {
        default: [{ question: '', answer: '' }],
        parseHTML: (element) => {
          const itemsAttr = element.getAttribute('data-items');
          return itemsAttr ? JSON.parse(itemsAttr) : [{ question: '', answer: '' }];
        },
        renderHTML: (attributes) => {
          if (!attributes.items || !Array.isArray(attributes.items)) {
            return {};
          }
          return {
            'data-items': JSON.stringify(attributes.items),
          };
        },
      },
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
        tag: 'div[data-type="faq"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'faq',
        'data-items': JSON.stringify(node.attrs.items || [{ question: '', answer: '' }]),
        'data-id': node.attrs.id || Math.random().toString(36).substring(7),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FAQRendererComponent);
  },
});
