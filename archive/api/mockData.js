// trend for a sparkline
const generateHistory = (points = 7, baseValue) => {
  return Array.from({ length: points }).map((_, i) => {
    const randomFlux = Math.random() * 20 - 10; // fluctuation +/- 10
    const date = new Date();
    date.setDate(date.getDate() - (points - i)); // past dates

    return {
      date: date.toISOString().split("T")[0],
      value: Math.max(0, Math.round(baseValue + randomFlux)),
    };
  });
};

export const fetchMockMetrics = () => {
  return new Promise((resolve, reject) => {
    // simulate network latency (500ms - 1500ms)
    const delay = Math.random() * 1000 + 500;

    setTimeout(() => {
      // 10% chance to simulate an API error (Good for testing Error Boundaries later)
      const shouldFail = Math.random() < 0.1;

      if (shouldFail) {
        reject(new Error("Failed to fetch market data. Server overloaded."));
        return;
      }

      resolve({
        lastUpdated: new Date().toISOString(),
        metrics: [
          {
            id: "nvda-pe",
            title: "NVIDIA P/E Ratio",
            category: "financial",
            currentValue: 74.2,
            unit: "x",
            change24h: 2.4,
            trend: "up",
            description:
              "Price-to-Earnings ratio. High values indicate high growth expectations.",
            history: generateHistory(7, 74),
          },
          {
            id: "search-llm",
            title: 'Search: "LLM"',
            category: "social",
            currentValue: 88,
            unit: "index",
            change24h: -5.1,
            trend: "down",
            description: "Google Trends interest over time (0-100).",
            history: generateHistory(7, 90),
          },
          {
            id: "hacker-news",
            title: "HackerNews Sentiment",
            category: "social",
            currentValue: 42,
            unit: "% pos",
            change24h: 0.5,
            trend: "flat",
            description: "Percentage of positive comments on AI threads.",
            history: generateHistory(7, 42),
          },
        ],
      });
    }, delay);
  });
};
