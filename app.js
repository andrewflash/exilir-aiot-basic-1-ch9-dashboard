/* Dashboard vanilla JS. MQTT melalui Paho 1.0.1 dan WebSocket. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const labels = { diam: "Diam", jalan: "Jalan", lari: "Lari", unknown: "Unknown" };
  const states = {
    stable: "Hasil voting stabil", unknown: "Confidence / voting belum cukup",
    calibrating: "Diam 3 detik untuk kalibrasi", waiting: "Menunggu window model",
    stale: "Hasil model belum diperbarui", sensor_error: "Periksa sensor dan wiring",
    model_error: "Periksa model / memori", calibration_failed: "Kalibrasi gagal; kirim r",
  };
  const fmt = new Intl.NumberFormat("id-ID");
  const settingsKey = "exilir-ch9-mqtt";
  let client = null, wanted = false, generation = 0, retryTimer = null, demoTimer = null;
  let last = null, receivedAt = 0, history = [], chart = [], lastInferenceKey = "";
  let settings = null, connected = false;
  let dataOrigin = "mqtt";

  function badge(id, text, kind) { $(id).textContent = text; $(id).className = `badge ${kind}`; }
  function message(text, error = false) { $("message").textContent = text; $("message").classList.toggle("error", error); }
  function controls() {
    $("connect").disabled = wanted;
    $("disconnect").disabled = !wanted && !demoTimer;
    $("broker-url").disabled = $("topic").disabled = wanted;
    $("demo").textContent = demoTimer ? "Hentikan demo" : "Coba demo";
  }

  function validate(raw) {
    if (raw.length > 4096) throw new Error("Pesan terlalu besar.");
    const data = JSON.parse(raw);
    if (!data || Array.isArray(data) || data.schema !== 1) throw new Error("Schema telemetry harus 1.");
    if (typeof data.device_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(data.device_id)) throw new Error("Device ID tidak valid.");
    if (typeof data.boot_id !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(data.boot_id)) throw new Error("Boot ID tidak valid.");
    for (const key of ["seq", "session", "inference_seq", "steps", "uptime_ms", "inference_ms", "dsp_ms", "nn_ms", "sample_gaps", "sensor_errors", "dropped_windows"]) {
      if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error(`Field ${key} tidak valid.`);
    }
    if (!Object.hasOwn(labels, data.activity) || !Object.hasOwn(labels, data.raw_label) || !Object.hasOwn(states, data.state)) throw new Error("Label / state tidak dikenal.");
    if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) throw new Error("Confidence harus 0–1.");
    if (!data.scores || ["diam", "jalan", "lari"].some((key) => !Number.isFinite(data.scores[key]) || data.scores[key] < 0 || data.scores[key] > 1)) throw new Error("Skor kelas tidak valid.");
    if (data.model_age_ms !== null && (!Number.isSafeInteger(data.model_age_ms) || data.model_age_ms < 0)) throw new Error("Usia model tidak valid.");
    if (!Number.isInteger(data.model_error)) throw new Error("Error model tidak valid.");
    return data;
  }

  function receive(raw, origin = "mqtt") {
    try {
      const data = validate(raw);
      if (last && data.device_id === last.device_id && data.boot_id === last.boot_id && data.seq <= last.seq) return;
      if (last && (data.device_id !== last.device_id || data.boot_id !== last.boot_id || data.session !== last.session)) {
        history = []; chart = []; lastInferenceKey = "";
      }
      last = data;
      dataOrigin = origin;
      $("data-mode").textContent = origin === "demo" ? "Simulasi · tanpa broker" : "Live MQTT";
      receivedAt = Date.now();
      $("payload").textContent = JSON.stringify(data, null, 2);
      history.unshift({ time: new Date(receivedAt).toLocaleTimeString("id-ID"), ...data });
      history = history.slice(0, 12);
      const key = `${data.boot_id}:${data.session}:${data.inference_seq}`;
      if (data.model_age_ms !== null && data.model_age_ms <= 7000 && data.model_error === 0 && key !== lastInferenceKey) {
        chart.push(data.confidence); chart = chart.slice(-40); lastInferenceKey = key;
      }
      renderHistory(); renderChart(); tick();
      if (origin === "mqtt") message("Menerima telemetry. Aktivitas stabil mengikuti hasil voting pada perangkat.");
    } catch (error) { message(`Pesan diabaikan: ${error.message}`, true); }
  }

  function renderHistory() {
    const rows = history.map((item) => {
      const row = document.createElement("tr");
      for (const value of [item.time, labels[item.activity], labels[item.raw_label], fmt.format(item.steps)]) {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      }
      return row;
    });
    $("history").replaceChildren(...rows);
  }
  function renderChart() {
    const points = chart.map((value, i) => `${chart.length === 1 ? 600 : 36 + i * 564 / (chart.length - 1)},${156 - value * 136}`);
    $("chart-line").setAttribute("points", points.join(" "));
    $("chart-point").toggleAttribute("hidden", !chart.length);
    if (chart.length) $("chart-point").setAttribute("cy", String(156 - chart.at(-1) * 136));
    $("chart-caption").textContent = chart.length ? `${chart.length} hasil inference` : "Belum ada hasil model";
  }
  function clearView() {
    last = null; receivedAt = 0; history = []; chart = []; lastInferenceKey = "";
    dataOrigin = "mqtt"; $("data-mode").textContent = "Live MQTT";
    for (const id of ["steps", "activity", "confidence", "inference", "device-id", "firmware", "uptime", "model-age", "sample-gaps", "errors", "dropped-windows"]) $(id).textContent = "—";
    for (const key of ["diam", "jalan", "lari"]) { $("score-" + key).textContent = "—"; $("bar-" + key).style.width = "0%"; $("bar-" + key).setAttribute("aria-valuenow", "0"); }
    $("raw-label").textContent = "Prediksi terbaru: —";
    $("decision-note").textContent = "Menunggu hasil voting";
    $("timing-detail").textContent = "DSP + neural network";
    $("activity-card").className = "metric activity unknown";
    $("last-update").textContent = "Belum ada data";
    $("payload").textContent = "Belum ada pesan JSON.";
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 4; cell.className = "empty"; cell.textContent = "Menunggu telemetry perangkat."; row.append(cell);
    $("history").replaceChildren(row); renderChart();
    badge("device-status", "Menunggu perangkat", "neutral"); document.body.classList.remove("stale");
  }

  function tick() {
    if (!last) return;
    const elapsed = Math.max(0, Date.now() - receivedAt);
    const stale = elapsed > 12000;
    const age = last.model_age_ms === null ? null : last.model_age_ms + elapsed;
    const modelValid = !stale && age !== null && age <= 7000 && last.model_error === 0;
    document.body.classList.toggle("stale", stale);
    badge("device-status", stale ? "Data belum diperbarui" : dataOrigin === "demo" ? (demoTimer ? "Perangkat simulasi" : "Simulasi dijeda") : "Data diterima", stale ? "warning" : dataOrigin === "demo" ? "demo" : "online");
    $("last-update").textContent = `Pesan terakhir ${Math.floor(elapsed / 1000)} detik lalu`;
    $("steps").textContent = fmt.format(last.steps);
    const activity = modelValid ? last.activity : "unknown";
    $("activity").textContent = labels[activity];
    $("activity-card").className = `metric activity ${activity}`;
    $("decision-note").textContent = stale ? "Tampilan menyimpan data terakhir" : age !== null && age > 7000 ? states.stale : states[last.state];
    $("confidence").textContent = modelValid ? `${(last.confidence * 100).toFixed(1)}%` : "—";
    $("raw-label").textContent = `Prediksi terbaru: ${modelValid ? labels[last.raw_label] : "—"}`;
    $("inference").textContent = modelValid ? `${last.inference_ms} ms` : "—";
    $("timing-detail").textContent = modelValid ? `DSP ${last.dsp_ms} ms · NN ${last.nn_ms} ms` : "DSP + neural network";
    for (const key of ["diam", "jalan", "lari"]) {
      const percent = modelValid ? last.scores[key] * 100 : 0;
      $("score-" + key).textContent = modelValid ? `${percent.toFixed(1)}%` : "—";
      $("bar-" + key).style.width = `${percent}%`; $("bar-" + key).setAttribute("aria-valuenow", percent.toFixed(1));
    }
    $("device-id").textContent = last.device_id;
    $("firmware").textContent = typeof last.firmware === "string" ? last.firmware : "—";
    $("uptime").textContent = `${Math.floor(last.uptime_ms / 1000)} s`;
    $("model-age").textContent = age === null ? "Belum ada hasil" : `${(age / 1000).toFixed(1)} s`;
    $("sample-gaps").textContent = String(last.sample_gaps);
    $("errors").textContent = `${last.sensor_errors} / ${last.model_error}`;
    $("dropped-windows").textContent = String(last.dropped_windows);
  }

  function stop() {
    wanted = false; connected = false; ++generation;
    clearTimeout(retryTimer); clearInterval(demoTimer); retryTimer = demoTimer = null;
    const old = client; client = null;
    try { if (old?.isConnected()) old.disconnect(); } catch (_) { /* sudah terputus */ }
    badge("broker-status", "Terputus", "neutral");
    $("data-mode").textContent = dataOrigin === "demo" ? "Simulasi · dijeda" : "Live MQTT"; controls();
  }
  function reconnect(gen) {
    if (!wanted || gen !== generation) return;
    connected = false; badge("broker-status", "Menyambung ulang", "warning");
    clearTimeout(retryTimer); retryTimer = setTimeout(() => connect(gen), 5000);
  }
  function connect(gen) {
    if (!wanted || gen !== generation) return;
    badge("broker-status", "Menghubungkan", "warning");
    const id = "web-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => n.toString(16).padStart(2, "0")).join("");
    const current = new Paho.MQTT.Client(settings.broker, id); client = current;
    current.onConnectionLost = () => {
      if (client !== current || gen !== generation) return;
      message("Koneksi broker terputus; mencoba kembali dalam 5 detik.", true); reconnect(gen);
    };
    current.onMessageArrived = (msg) => {
      if (client !== current || gen !== generation || msg.destinationName !== settings.topic) return;
      if (msg.retained) { message("Pesan tersimpan diabaikan; menunggu telemetry baru."); return; }
      receive(msg.payloadString);
    };
    current.connect({ useSSL: settings.broker.startsWith("wss:"), timeout: 8, mqttVersion: 4, cleanSession: true,
      onSuccess: () => {
        if (!wanted || gen !== generation || client !== current) { try { current.disconnect(); } catch (_) {} return; }
        current.subscribe(settings.topic, { qos: 0,
          onSuccess: () => { if (client !== current || gen !== generation) return; connected = true; badge("broker-status", "Tersambung", "online"); message("Topic terhubung. Menunggu telemetry baru dari perangkat."); },
          onFailure: () => { if (client !== current || gen !== generation) return; message("Subscribe gagal; mencoba kembali.", true); try { current.disconnect(); } catch (_) {} reconnect(gen); },
        });
      },
      onFailure: (error) => { if (client !== current || gen !== generation) return; message(`Broker belum terhubung: ${error.errorMessage}. Retry 5 detik.`, true); reconnect(gen); },
    });
  }

  $("connection-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const broker = $("broker-url").value.trim(), topic = $("topic").value.trim();
    try {
      const url = new URL(broker);
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error("Gunakan URL ws:// atau wss:// tanpa kredensial/query.");
      if (location.protocol === "https:" && url.protocol !== "wss:") throw new Error("Halaman HTTPS memerlukan broker wss://.");
      if (!topic || /[+#\s]/.test(topic) || topic.length > 200 || /XXXXXXXXXXXX/.test(topic)) throw new Error("Salin topic lengkap dari Serial; tanpa wildcard atau spasi.");
      if (!window.Paho?.MQTT) throw new Error("Library Paho tidak dimuat. Periksa folder vendor.");
      stop(); clearView(); settings = { broker: url.href, topic }; wanted = true;
      try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch (_) {}
      controls(); connect(generation);
    } catch (error) { if (wanted) stop(); message(error.message, true); }
  });
  $("disconnect").addEventListener("click", () => { stop(); message("Koneksi dihentikan. Data terakhir tetap ditampilkan."); });
  $("demo").addEventListener("click", () => {
    if (demoTimer) { stop(); message("Demo dihentikan. Hubungkan perangkat untuk data nyata."); return; }
    stop(); clearView(); let seq = 0, steps = 0; const started = Date.now();
    const emit = () => {
      const raw = ["diam", "jalan", "lari"][Math.floor(seq / 5) % 3];
      const scores = { diam: .04, jalan: .04, lari: .04 }; scores[raw] = .92;
      if (raw !== "diam") steps += raw === "lari" ? 4 : 2;
      receive(JSON.stringify({ schema: 1, device_id: "exilir-c5-DEMO", boot_id: "DEMO", seq: ++seq, session: 1,
        inference_seq: seq, uptime_ms: Date.now() - started, steps, activity: raw, raw_label: raw, confidence: .92,
        scores, inference_ms: 14, dsp_ms: 12, nn_ms: 2, model_age_ms: 0, state: "stable", model_error: 0,
        sample_gaps: 0, sensor_errors: 0, dropped_windows: 0, firmware: "demo-lokal" }), "demo");
    };
    demoTimer = setInterval(emit, 2000); emit(); controls();
    badge("broker-status", "Demo lokal", "demo"); $("data-mode").textContent = "Simulasi · tanpa broker";
    message("Data simulasi di browser. Demo tidak mengirim pesan ke broker.");
  });
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    if (saved?.broker && saved?.topic) { $("broker-url").value = saved.broker; $("topic").value = saved.topic; }
  } catch (_) {}
  setInterval(tick, 500);
  window.addEventListener("beforeunload", stop);
})();
