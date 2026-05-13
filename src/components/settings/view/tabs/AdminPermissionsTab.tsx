import { useCallback, useEffect, useState } from 'react';
import { Loader2, Shield, ToggleLeft, ToggleRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../../utils/api';

type UserWithPermissions = {
  id: number;
  username: string;
  email: string | null;
  permissions: string[];
};

export default function AdminPermissionsTab() {
  const { t } = useTranslation('settings');
  const [users, setUsers] = useState<UserWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.admin.getPermissions();
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data = await res.json();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggle = async (userId: number, hasPermission: boolean) => {
    setToggling(userId);
    try {
      const res = hasPermission
        ? await api.admin.revokePermission(userId, 'view_all_usage')
        : await api.admin.grantPermission(userId, 'view_all_usage');
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      // Update local state
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                permissions: hasPermission
                  ? u.permissions.filter((p) => p !== 'view_all_usage')
                  : [...u.permissions, 'view_all_usage'],
              }
            : u,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.toggleError'));
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-blue-600" />
        <h3 className="text-lg font-medium text-foreground">{t('admin.title')}</h3>
      </div>

      <p className="text-sm text-muted-foreground">{t('admin.description')}</p>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t('admin.table.user')}</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t('admin.table.email')}</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">{t('admin.table.viewAllUsage')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const has = u.permissions.includes('view_all_usage');
                const isToggling = toggling === u.id;
                return (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">{u.username}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email || '\u2014'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleToggle(u.id, has)}
                        disabled={isToggling}
                        className="inline-flex items-center text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {isToggling ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : has ? (
                          <ToggleRight className="h-6 w-6 text-blue-600" />
                        ) : (
                          <ToggleLeft className="h-6 w-6" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-muted-foreground">
                    {t('admin.noUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
