/**
 * 말투·교정·용어를 "원문 → 변환" 목록으로 편집하는 화면 도우미.
 * desk·관리 페이지·방송실 설정에서 같이 씁니다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LI = root.LI || {};
  root.LI.speechStyleUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function catalog() {
    return (typeof LI !== "undefined" && LI.catalog) ? LI.catalog : null;
  }

  function parse(text) {
    const cat = catalog();
    if (cat && typeof cat.parseSpeechLines === "function") return cat.parseSpeechLines(text);
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ action: "apply", from: line, to: "" }));
  }

  function format(rows) {
    const cat = catalog();
    return (rows || [])
      .map((row) => {
        if (cat && typeof cat.formatSpeechLine === "function") return cat.formatSpeechLine(row);
        if (!row || !row.from) return "";
        const tag = row.action === "ignore" ? "[무시]" : "[적용]";
        return row.to ? `${tag} ${row.from} → ${row.to}` : `${tag} ${row.from}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  function emptyRow() {
    return { action: "apply", from: "", to: "" };
  }

  /**
   * @param {HTMLElement} host
   * @param {object} opts
   * @param {string} [opts.value]
   * @param {string} [opts.fromLabel]
   * @param {string} [opts.toLabel]
   * @param {function} [opts.onChange]
   * @param {boolean} [opts.readOnly]
   */
  function mount(host, opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const fromLabel = options.fromLabel || "원 말투·특이점";
    const toLabel = options.toLabel || "변환·처리";
    const readOnly = Boolean(options.readOnly);
    let rows = parse(options.value);
    if (!rows.length) rows = [emptyRow()];

    function emit() {
      if (typeof options.onChange === "function") options.onChange(format(collect()));
    }

    function collect() {
      return [...host.querySelectorAll(".speech-row")].map((row) => ({
        action: row.querySelector(".speech-action")?.value === "ignore" ? "ignore" : "apply",
        from: row.querySelector(".speech-from")?.value.trim() || "",
        to: row.querySelector(".speech-to")?.value.trim() || "",
      })).filter((row) => row.from);
    }

    function paint() {
      host.innerHTML = "";
      host.classList.add("speech-list");
      const head = document.createElement("div");
      head.className = "speech-head";
      head.innerHTML = `<span>처리</span><span>${fromLabel}</span><span>${toLabel}</span><span></span>`;
      host.append(head);

      rows.forEach((row, index) => {
        const wrap = document.createElement("div");
        wrap.className = "speech-row";

        const action = document.createElement("select");
        action.className = "speech-action";
        action.setAttribute("aria-label", "처리");
        [["apply", "적용"], ["ignore", "무시"]].forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          action.append(option);
        });
        action.value = row.action === "ignore" ? "ignore" : "apply";
        action.disabled = readOnly;

        const from = document.createElement("input");
        from.className = "speech-from";
        from.type = "text";
        from.maxLength = 120;
        from.placeholder = fromLabel;
        from.value = row.from || "";
        from.readOnly = readOnly;

        const to = document.createElement("input");
        to.className = "speech-to";
        to.type = "text";
        to.maxLength = 160;
        to.placeholder = toLabel;
        to.value = row.to || "";
        to.readOnly = readOnly;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ghost speech-remove";
        remove.textContent = "삭제";
        remove.disabled = readOnly;
        remove.addEventListener("click", () => {
          rows = collect();
          rows.splice(index, 1);
          if (!rows.length) rows = [emptyRow()];
          paint();
          emit();
        });

        [action, from, to].forEach((el) => {
          el.addEventListener("change", () => {
            rows = collect();
            if (!rows.length) rows = [emptyRow()];
            emit();
          });
          el.addEventListener("input", () => {
            // 입력 중에는 목록을 다시 그리지 않고 값만 알립니다.
          });
        });
        from.addEventListener("blur", () => {
          rows = collect();
          emit();
        });
        to.addEventListener("blur", () => {
          rows = collect();
          emit();
        });

        wrap.append(action, from, to, remove);
        host.append(wrap);
      });

      if (!readOnly) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "ghost speech-add";
        add.textContent = "줄 추가";
        add.addEventListener("click", () => {
          rows = collect();
          rows.push(emptyRow());
          paint();
        });
        host.append(add);
      }
    }

    paint();
    return {
      getValue: () => format(collect()),
      setValue: (text) => {
        rows = parse(text);
        if (!rows.length) rows = [emptyRow()];
        paint();
      },
      destroy: () => {
        host.innerHTML = "";
        host.classList.remove("speech-list");
      },
    };
  }

  return { mount, parse, format };
});
