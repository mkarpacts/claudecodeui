import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebSocket } from '../../../../contexts/WebSocketContext';

// Grace delay so the routine 3s reconnect after a server restart doesn't flash the banner
const SHOW_DELAY_MS = 3_000;

const ConnectionLostBanner = () => {
  const { isConnected } = useWebSocket();
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation('chat');

  useEffect(() => {
    if (isConnected) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isConnected]);

  if (!visible) return null;

  return (
    <div className="mx-4 mb-1 flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-600 dark:text-yellow-400">
      <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-yellow-500" />
      {t('connectionLost', {
        defaultValue: 'Connection lost — reconnecting… Messages you send will be delivered once reconnected.',
      })}
    </div>
  );
};

export default ConnectionLostBanner;
