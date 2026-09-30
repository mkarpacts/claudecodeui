import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

// Long user messages (pasted code, expanded skill bodies) render clamped until expanded.
// The visible height is the literal `line-clamp-4` class below (Tailwind needs it spelled out).
const COLLAPSE_MAX_LINES = 8;
const COLLAPSE_MAX_CHARS = 600;

type CollapsibleUserTextProps = {
  content: string;
};

const CollapsibleUserText = ({ content }: CollapsibleUserTextProps) => {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const isCollapsible = content.length > COLLAPSE_MAX_CHARS ||
    content.split('\n').length > COLLAPSE_MAX_LINES;

  const handleToggle = () => {
    if (isExpanded) {
      // Collapsing a long message shrinks it above the viewport; bring it back into view.
      requestAnimationFrame(() => textRef.current?.scrollIntoView({ block: 'nearest' }));
    }
    setIsExpanded((prev) => !prev);
  };

  return (
    <>
      <div ref={textRef} className={`whitespace-pre-wrap break-words text-sm ${isCollapsible && !isExpanded ? 'line-clamp-4' : ''}`}>
        {content}
      </div>
      {isCollapsible && (
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={isExpanded}
          className="mt-1 flex items-center gap-1 text-xs font-medium text-blue-100 hover:text-white"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          {isExpanded ? t('userMessage.showLess') : t('userMessage.showMore')}
        </button>
      )}
    </>
  );
};

export default CollapsibleUserText;
