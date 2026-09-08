"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const data = window.YUE2_BENCHMARKS;
  const tabs = [...document.querySelectorAll('.overview-tabs [role="tab"]')];
  function activateTab(tab, focus = false) {
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      $(item.getAttribute("aria-controls")).hidden = !active;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", event => {
      const next = { ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      activateTab(tabs[next], true);
    });
  });

  const operations = {
    create: ["Your idea", "Lyrics + style", "Describe the song you want to hear.",
      "AR · Compose", "ABC score", "Melody, chords, tempo, meter, and form.",
      "Create: the AR stream generates the score and semantic tokens from lyrics and style. The NAR stream uses the full text, score, and semantic prefix to generate acoustic latents."],
    cover: ["Your reference", "Reference audio", "Choose a song and a new style or lyrical direction.",
      "SheetSage2 · Transcribe", "Recovered score", "Recover the composition from the reference song.",
      "Cover: SheetSage2 transcribes the reference audio outside the YuE2 generator. The recovered score is supplied as a fixed prefix alongside new conditions; YuE2 generates new semantic tokens and acoustic latents."],
    edit: ["Your revision", "An edited plan", "Revise the score, lyrics, tempo, or arrangement.",
      "Fixed prefix · Condition", "Revised score", "Use your ABC notation as the musical condition.",
      "Edit: keep the revised score as a fixed prefix and regenerate the downstream semantic and acoustic states. YuE2 re-renders the whole song rather than splicing a local audio region."],
  };
  document.querySelectorAll("[data-operation]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-operation]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      ["flowInputKicker", "flowInputTitle", "flowInputText", "flowPlanKicker", "flowPlanTitle", "flowPlanText", "operationDescription"]
        .forEach((id, index) => { $(id).textContent = operations[button.dataset.operation][index]; });
    });
  });

  if (!data || !Array.isArray(data.rows)) {
    $("benchmarkChart").textContent = "The interactive comparison could not load. Download the complete results below.";
    return;
  }
  const dataset = "WSB";
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  $("benchmarkMetric").replaceChildren(...data.metrics.map(metric => {
    const option = node("option", metric.label);
    option.value = metric.key;
    return option;
  }));
  function render() {
    const metric = data.metrics.find(item => item.key === $("benchmarkMetric").value);
    const scores = data.rows.filter(row => row.dataset === dataset)
      .sort((a, b) => (a[metric.key] - b[metric.key]) * (metric.lowerIsBetter ? 1 : -1));
    const format = value => metric.key === "per" ? `${(value * 100).toFixed(2)}%` : value.toFixed(4);
    const direction = metric.lowerIsBetter ? "Lower is better ↓" : "Higher is better ↑";
    const rank = row => 1 + scores.filter(other => metric.lowerIsBetter
      ? other[metric.key] < row[metric.key] : other[metric.key] > row[metric.key]).length;
    const best = scores.find(row => row.system === "YuE2 (best-of-8)");
    const base = scores.find(row => row.system === "YuE2");
    $("benchmarkTag").textContent = rank(best) === 1 ? (metric.lowerIsBetter ? "Lowest observed error" : "Highest observed score") : "YuE2 in the comparison";
    $("benchmarkValue").textContent = format(best[metric.key]);
    $("benchmarkRank").textContent = `#${rank(best)} of ${scores.length} evaluated settings`;
    $("benchmarkBaseValue").textContent = format(base[metric.key]);
    $("benchmarkBaseRank").textContent = `#${rank(base)} of ${scores.length}`;
    $("benchmarkDefinition").textContent = `${metric.label} · ${metric.description}. ${direction.slice(0, -2)}.`;
    const title = `${data.datasets.find(item => item.id === dataset).label} · ${metric.label}`;
    $("benchmarkChartTitle").textContent = title;
    $("benchmarkDirection").textContent = direction;
    const visible = scores.filter((row, index) => index < 5 || row.system.startsWith("YuE"));
    $("benchmarkChart").replaceChildren(...visible.map(row => {
      const item = node("li", undefined, "chart-row");
      item.value = rank(row);
      item.dataset.system = row.system;
      if (row.system.startsWith("YuE2")) item.classList.add("is-yue2");
      if (row === best) item.classList.add("is-best-of-eight");
      const label = node("span", row.system, "chart-system");
      const position = node("span", String(rank(row)).padStart(2, "0"), "chart-rank");
      position.setAttribute("aria-hidden", "true");
      label.prepend(position);
      const track = node("span", undefined, "chart-track");
      track.setAttribute("aria-hidden", "true");
      const bar = node("span", undefined, "chart-bar");
      bar.style.width = `${Math.max(0, Math.min(100, row[metric.key] / metric.maximum * 100))}%`;
      track.append(bar);
      item.append(label, track, node("strong", format(row[metric.key]), "chart-value"));
      return item;
    }));
    $("comparisonCaption").textContent = `${title} · ${scores[0].n} prompts · September 5, 2026`;
    $("comparisonMetric").textContent = `${metric.label} ${metric.lowerIsBetter ? "↓" : "↑"}`;
    $("comparisonRows").replaceChildren(...scores.map(row => {
      const tr = node("tr");
      if (row.system.startsWith("YuE2")) tr.classList.add("is-yue2");
      const name = node("th", row.system);
      name.scope = "row";
      tr.append(node("td", rank(row)), name, node("td", row.n), node("td", format(row[metric.key])));
      return tr;
    }));
  }
  $("benchmarkMetric").addEventListener("change", render);
  render();
})();
