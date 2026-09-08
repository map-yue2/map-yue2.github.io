"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const data = window.YUE2_BENCHMARKS;
  if (!data || !Array.isArray(data.rows)) {
    $("benchmarkStatus").textContent = "The comparison could not load. Download the complete results below.";
    return;
  }
  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  $("benchmarkMetric").replaceChildren(...data.metrics.map(metric => {
    const option = node("option", metric.label);
    option.value = metric.key;
    return option;
  }));
  function render() {
    const metric = data.metrics.find(item => item.key === $("benchmarkMetric").value);
    const rows = data.rows.filter(row => row.dataset === "WSB")
      .sort((a, b) => (a[metric.key] - b[metric.key]) * (metric.lowerIsBetter ? 1 : -1));
    const format = value => metric.key === "per" ? `${(value * 100).toFixed(2)}%` : value.toFixed(4);
    const rank = row => 1 + rows.filter(other => metric.lowerIsBetter
      ? other[metric.key] < row[metric.key] : other[metric.key] > row[metric.key]).length;
    $("benchmarkStatus").textContent = `${metric.description}. ${metric.lowerIsBetter ? "Lower" : "Higher"} is better.`;
    $("comparisonCaption").textContent = `WildSongBench · ${metric.label} · 192 prompts · September 5, 2026`;
    $("comparisonMetric").textContent = `${metric.label} ${metric.lowerIsBetter ? "↓" : "↑"}`;
    $("comparisonRows").replaceChildren(...rows.map(row => {
      const tr = node("tr");
      if (row.system.startsWith("YuE2")) tr.classList.add("is-yue2");
      const name = node("th", row.system);
      name.scope = "row";
      tr.append(node("td", rank(row)), name, node("td", row.n), node("td", format(row[metric.key])));
      return tr;
    }));
  }
  $("benchmarkMetric").addEventListener("change", render);
  // The optional data table does no row construction until the visitor opens it.
  $("benchmarkDetails").addEventListener("toggle", () => {
    if ($("benchmarkDetails").open) render();
  });
})();
