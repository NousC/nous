import { useState, useEffect } from 'react';

interface SignupStats {
  remaining: number;
  total: number;
  max: number;
  isFull: boolean;
  loading: boolean;
}

export function useSignupStats(): SignupStats {
  const [stats, setStats] = useState<SignupStats>({
    remaining: 95,
    total: 0,
    max: 95,
    isFull: false,
    loading: true,
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL ?? '';
        const response = await fetch(`${apiUrl}/api/signup-stats`);
        if (response.ok) {
          const data = await response.json();
          // Validate that the response has the expected shape
          if (typeof data.remaining === 'number' && typeof data.total === 'number') {
            setStats({
              remaining: data.remaining,
              total: data.total,
              max: data.max ?? 95,
              isFull: data.isFull ?? false,
              loading: false,
            });
          } else {
            setStats(prev => ({ ...prev, loading: false }));
          }
        } else {
          setStats(prev => ({ ...prev, loading: false }));
        }
      } catch (error) {
        console.error('Failed to fetch signup stats:', error);
        setStats(prev => ({ ...prev, loading: false }));
      }
    };

    fetchStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  return stats;
}
