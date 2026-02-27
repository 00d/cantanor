import { useBubbleMetrics } from "./hooks/useBubbleMetrics";

function App() {
  const { data, loading, error, refreshMetrics } = useBubbleMetrics();

  if (loading) return <h1>Analyzing the Bubble...</h1>;
  if (error)
    return (
      <div style={{ color: "red" }}>
        <h1>Error!</h1>
        <p>{error}</p>
        <button onClick={refreshMetrics}>Try Again</button>
      </div>
    );

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>AI Bubble Monitor Debugger</h1>
      <button onClick={refreshMetrics}>Refresh Data</button>
      <pre
        style={{ background: "#f4f4f4", padding: "10px", marginTop: "20px" }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default App;
