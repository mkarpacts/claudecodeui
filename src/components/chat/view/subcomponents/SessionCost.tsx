import { CircleDollarSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCost, formatCostValue } from '../../../settings/view/tabs/token-usage/utils';

type SessionCostProps = {
  cost: number | null | undefined;
};

export default function SessionCost({ cost }: SessionCostProps) {
  const { t } = useTranslation('chat');

  if (cost == null) return null;

  return (
    <div
      className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400"
      title={`${t('input.sessionCost')}: ${formatCost(cost)}`}
    >
      <CircleDollarSign className="h-[18px] w-[18px] opacity-70 sm:h-5 sm:w-5" strokeWidth={1.75} />
      <span className="tabular-nums">{formatCostValue(cost)}</span>
    </div>
  );
}
