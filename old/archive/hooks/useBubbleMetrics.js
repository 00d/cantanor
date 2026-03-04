import { useState, useEffect, useCallback } from "react";
import { fetchMockMetrics } from "../api/mockData";

export const useBubbleMetrics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // fetch logic inside useCallback so it is stable
  const refreshMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchMockMetrics();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // trigger fetch on mount
  useEffect(() => {
    refreshMetrics();
  }, [refreshMetrics]);

  return {
    data,
    loading,
    error,
    refreshMetrics,
  };
};
/*
Race Condition Safety: (Optional but good) check if the component is still mounted before setting state, though modern React handles this gracefully.
*/
