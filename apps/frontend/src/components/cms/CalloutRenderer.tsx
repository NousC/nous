import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';

export interface CalloutOptions {
  HTMLAttributes: Record<string, any>;
}

const CalloutRendererComponent = ({ node }: any) => {
  const { title, items } = node.attrs;

  if (!title && (!items || items.length === 0 || items.every((item: string) => !item))) {
    return null;
  }

  return (
    <NodeViewWrapper className="callout-renderer my-4 not-prose">
      <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
        {title && (
          <h3 className="!font-space-mono !font-bold !text-lg !text-white !mb-4 !mt-0">
            {title}
          </h3>
        )}
        {items && items.length > 0 && items.some((item: string) => item) && (
          <ul className="!space-y-3 !list-none !pl-0 !m-0">
            {items
              .filter((item: string) => item)
              .map((item: string, index: number) => (
                <li key={index} className="!flex !items-start !gap-3 !mb-0 !pl-0">
                  <span className="!text-white/60 !mt-1 !flex-shrink-0 !text-lg">•</span>
                  <span className="!font-space-mono !text-white/85 !leading-relaxed">{item}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const CalloutRenderer = Node.create<CalloutOptions>({
  name: 'callout',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: 'block',

  content: '',

  addAttributes() {
    return {
      title: {
        default: 'Key Takeaways',
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: (attributes) => {
          if (!attributes.title) {
            return {};
          }
          return {
            'data-title': attributes.title,
          };
        },
      },
      items: {
        default: [''],
        parseHTML: (element) => {
          const itemsAttr = element.getAttribute('data-items');
          return itemsAttr ? JSON.parse(itemsAttr) : [''];
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
        tag: 'div[data-type="callout"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'callout',
        'data-title': node.attrs.title || 'Key Takeaways',
        'data-items': JSON.stringify(node.attrs.items || ['']),
        'data-id': node.attrs.id || Math.random().toString(36).substring(7),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutRendererComponent);
  },
});
