// helper to format numbers based on the unit type
const formatValue = (value, unit) => {
  if (unit === "$") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  }
  if (unit === "%") {
    return `${value.toFixed(1)}%`;
  }
  // default for "x" (P/E ratio) or "index"
  return `${value} ${unit}`;
};

export default formatValue;
